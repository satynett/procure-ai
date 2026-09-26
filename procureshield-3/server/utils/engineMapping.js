// engineMapping.js
// Pure, dependency-free translation between the GeM-shaped demo data used by
// this prototype (bidders.json / bids.json) and the ProcureShield Engine's
// record schema, plus the reverse mapping from engine output back into the
// shapes the React client already consumes.
//
// NOTHING in this file scores anything. All risk scores, signals and
// explanations come from the Python engine (see engineClient.js). This module
// only reshapes data, so it is fully unit-testable with no network.

import crypto from "crypto";

// ---------------------------------------------------------------------
// Engine signal codes -> UI evidence codes + labels
// ---------------------------------------------------------------------
export const SIGNAL_META = {
  SHARED_DIRECTORS: { ui: "sharedDirector", label: "Shared Director" },
  SHARED_ADDRESS: { ui: "sharedAddress", label: "Shared Address" },
  REPEATED_CO_BIDDING: { ui: "repeatedCoBidding", label: "Repeated Co-Bidding" },
  BID_PRICE_SIMILARITY: { ui: "bidPriceSimilarity", label: "Bid Price Similarity" },
  DUPLICATE_BID_DOCUMENTS: { ui: "duplicateBidDocuments", label: "Identical Bid Documents" },
  COVER_BID_PATTERN: { ui: "coverBidPattern", label: "Cover Bid Pattern" },
  WINNER_ROTATION: { ui: "winnerRotation", label: "Winner Rotation" },
  MARKET_CONCENTRATION: { ui: "marketConcentration", label: "Market Concentration" },
  HIGH_CENTRALITY: { ui: "highCentrality", label: "High Network Centrality" },
  DENSE_SUBGROUP: { ui: "denseSubgroup", label: "Dense Bidding Subgroup" },
  UNCONTESTED_AWARDS: { ui: "uncontestedAwards", label: "Uncontested Awards" },
  // Registry signals computed here, not by the engine (it has no phone /
  // bank-account node types). See registrySignals.js.
  sharedPhone: { ui: "sharedPhone", label: "Shared Phone Number" },
  sharedBank: { ui: "sharedBank", label: "Shared Bank Account" },
};

export function uiEvidenceCode(engineCode) {
  return SIGNAL_META[engineCode]?.ui || engineCode;
}

export function signalLabel(code) {
  return SIGNAL_META[code]?.label || code;
}

// ---------------------------------------------------------------------
// Risk banding - mirrors the engine's RiskBands (25 / 50 / 75) but keeps the
// four Title-Case names the existing UI badges expect.
// ---------------------------------------------------------------------
export function riskCategory(score) {
  const s = Number(score) || 0;
  if (s > 75) return "Critical";
  if (s > 50) return "High";
  if (s > 25) return "Medium";
  return "Low";
}

// ---------------------------------------------------------------------
// bidders.json + bids.json  ->  engine records
// ---------------------------------------------------------------------
export function slugPerson(name = "") {
  const s = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s ? `PER-${s}` : null;
}

/**
 * Infer the winner of each tender as the lowest bid (the L1 convention used in
 * Indian public procurement). The demo dataset records no award outcome, and
 * `verification_status` is a workflow state, not an award. Ties are broken by
 * bid_id so the mapping stays deterministic.
 *
 * Returns Map<tender_id, bid_id>.
 */
export function inferTenderWinners(bids) {
  const byTender = new Map();
  bids.forEach((b) => {
    if (!b.tender_id) return;
    if (!byTender.has(b.tender_id)) byTender.set(b.tender_id, []);
    byTender.get(b.tender_id).push(b);
  });

  const winners = new Map();
  byTender.forEach((group, tenderId) => {
    const priced = group.filter((b) => Number.isFinite(Number(b.bid_amount)));
    if (priced.length === 0) return;
    const best = priced
      .slice()
      .sort((a, b) => Number(a.bid_amount) - Number(b.bid_amount) || String(a.bid_id).localeCompare(String(b.bid_id)))[0];
    winners.set(tenderId, best.bid_id);
  });
  return winners;
}

/**
 * Build the flat record list the engine's POST /analyze expects.
 * One record per bid. Optional fields are omitted rather than guessed:
 * `tender_value` is unknown in this dataset, so price-pressure signals are
 * reported by the engine as non-evaluable instead of being fabricated.
 */
function documentFingerprints(files) {
  if (!Array.isArray(files)) return [];
  return files.map((file) => {
    const base64 = String(file?.content_base64 || "").replace(/^data:[^,]+,/, "");
    if (!base64) return null;
    try { return crypto.createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex"); }
    catch { return null; }
  }).filter(Boolean);
}

export function buildEngineRecords(bidders, bids) {
  const byId = new Map(bidders.map((b) => [b.bidder_id, b]));
  const winners = inferTenderWinners(bids);

  return bids
    .filter((bid) => byId.has(bid.bidder_id))
    .map((bid) => {
      const bidder = byId.get(bid.bidder_id);
      const record = {
        company_id: bidder.bidder_id,
        company_name: bidder.company_name,
        tender_id: bid.tender_id,
        department_id: bid.category || null,
        bid_date: bid.submission_date || null,
        result: winners.get(bid.tender_id) === bid.bid_id ? "win" : "loss",
      };
      if (bidder.director_name) {
        record.person_id = slugPerson(bidder.director_name);
        record.person_name = bidder.director_name;
      }
      if (bidder.address) record.address = bidder.address;
      if (Number.isFinite(Number(bid.bid_amount))) record.bid_amount = Number(bid.bid_amount);
      const document_hashes = documentFingerprints(bid.submitted_document_files);
      if (document_hashes.length) record.document_hashes = document_hashes;
      // A known-collusive label, when the dataset carries one, lets the engine
      // train its GAT instead of falling back to unsupervised anomaly mode.
      // Absent labels are omitted, not defaulted to 0 - "unknown" and "known
      // clean" are different things and conflating them would poison training.
      if (bidder.label === 0 || bidder.label === 1) record.label = bidder.label;
      return record;
    });
}

// ---------------------------------------------------------------------
// engine /analyze output -> per-bidder risk map
// ---------------------------------------------------------------------
/**
 * The engine resolves aliases, so an entity may carry several raw ids in
 * `aliases`. Map every raw bidder_id it covers back to that entity.
 */
export function buildBidderRiskMap(analysis, bidderIds = []) {
  const entities = Object.values(analysis.entities || {});
  const map = {};
  bidderIds.forEach((id) => {
    map[id] = {
      entity_id: null,
      score: 0,
      category: "Low",
      signals: [],
      explanation: "",
      recommended_actions: [],
      cluster_id: null,
    };
  });

  entities.forEach((e) => {
    const rawIds = (e.aliases && e.aliases.length ? e.aliases : [e.entity_id]).filter(Boolean);
    rawIds.forEach((raw) => {
      if (!(raw in map)) return;
      map[raw] = {
        entity_id: e.entity_id,
        score: Math.round(Number(e.risk_score) || 0),
        category: riskCategory(e.risk_score),
        signals: (e.risk_signals || []).map((s) => ({
          code: s.code,
          ui_code: uiEvidenceCode(s.code),
          label: signalLabel(s.code),
          severity: s.severity,
          weight: s.weight,
          description: s.description,
          evidence: s.evidence || {},
        })),
        explanation: e.explanation || "",
        recommended_actions: e.recommended_actions || [],
        model_probability: e.model_probability ?? null,
        cluster_id: null,
      };
    });
  });

  return map;
}

// ---------------------------------------------------------------------
// engine suspicious_relationships -> UI edges
// ---------------------------------------------------------------------
const STRONG_PAIR_KEYS = ["shared_directors", "shared_addresses"];

/**
 * Convert engine relationship rows into the {source, target, score, evidence,
 * linkable} edge shape the network UI already renders. `entityToRaw` maps an
 * engine entity id back to the raw bidder_id.
 */
export function buildEdges(relationships, entityToRaw, registryEdges = []) {
  const edges = relationships
    .map((rel) => {
      const source = entityToRaw.get(rel.company_a) || rel.company_a;
      const target = entityToRaw.get(rel.company_b) || rel.company_b;
      const evidence = [];
      if (rel.shared_directors > 0) evidence.push("sharedDirector");
      if (rel.shared_addresses > 0) evidence.push("sharedAddress");
      if (rel.shared_tenders > 0) evidence.push("repeatedCoBidding");
      if (rel.alternating_wins > 0) evidence.push("winnerRotation");
      if (rel.shared_document_hashes > 0) evidence.push("duplicateBidDocuments");
      const strong = STRONG_PAIR_KEYS.some((k) => Number(rel[k]) > 0) || Number(rel.shared_document_hashes) > 0;
      return {
        source,
        target,
        score: Math.round((Number(rel.relationship_risk) || 0) * 100),
        evidence,
        reasons: rel.reasons || [],
        shared_tenders: rel.shared_tenders,
        alternating_wins: rel.alternating_wins,
        mean_price_gap: rel.mean_price_gap,
        linkable: strong,
        source_of_truth: "engine",
      };
    })
    .filter((e) => e.source !== e.target);

  // Merge registry (phone / bank) edges, which the engine cannot see.
  const key = (a, b) => [a, b].sort().join("::");
  const index = new Map(edges.map((e) => [key(e.source, e.target), e]));
  registryEdges.forEach((re) => {
    const k = key(re.source, re.target);
    const existing = index.get(k);
    if (existing) {
      re.evidence.forEach((ev) => {
        if (!existing.evidence.includes(ev)) existing.evidence.push(ev);
      });
      existing.reasons = [...existing.reasons, ...re.reasons];
      existing.linkable = true;
    } else {
      const merged = { ...re, score: 0, linkable: true, source_of_truth: "registry" };
      index.set(k, merged);
      edges.push(merged);
    }
  });

  return edges.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------
// edges -> clusters (connected components over linkable edges)
// ---------------------------------------------------------------------
export function buildClusters(edges, bidderIds, riskMap) {
  const parent = {};
  const find = (x) => {
    if (parent[x] === undefined) parent[x] = x;
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  };
  const union = (x, y) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  };

  bidderIds.forEach(find);
  edges.filter((e) => e.linkable).forEach((e) => union(e.source, e.target));

  const groups = new Map();
  bidderIds.forEach((id) => {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  });

  const clusters = Array.from(groups.values())
    .filter((members) => members.length > 1)
    .map((members) => {
      const clusterEdges = edges.filter(
        (e) => members.includes(e.source) && members.includes(e.target)
      );
      // Cluster risk = the highest engine score among its members. The engine
      // already accounts for group behaviour (rotation, capture ratio) inside
      // each member's score, so no re-weighting happens here.
      const scores = members.map((m) => riskMap[m]?.score || 0);
      const riskScore = Math.max(0, ...scores);

      // Evidence = union of member signals + edge evidence.
      const evidenceSet = new Set();
      const breakdownMap = new Map();
      members.forEach((m) => {
        (riskMap[m]?.signals || []).forEach((s) => {
          evidenceSet.add(s.ui_code);
          const prev = breakdownMap.get(s.ui_code);
          const contribution = Number(s.severity) * Number(s.weight);
          if (!prev || contribution > prev.contribution) {
            breakdownMap.set(s.ui_code, {
              code: s.ui_code,
              engine_code: s.code,
              label: s.label,
              severity: Number(s.severity),
              weight: Number(s.weight),
              contribution,
            });
          }
        });
      });
      clusterEdges.forEach((e) => e.evidence.forEach((ev) => evidenceSet.add(ev)));

      return {
        members: members.slice().sort(),
        edges: clusterEdges,
        risk_score: riskScore,
        risk_category: riskCategory(riskScore),
        evidence: Array.from(evidenceSet),
        signal_breakdown: Array.from(breakdownMap.values()).sort(
          (a, b) => b.contribution - a.contribution
        ),
      };
    })
    .sort((a, b) => b.risk_score - a.risk_score)
    .map((c, idx) => ({ ...c, cluster_id: `CLU-${String(idx + 1).padStart(2, "0")}` }));

  clusters.forEach((c) => {
    c.members.forEach((m) => {
      if (riskMap[m]) riskMap[m].cluster_id = c.cluster_id;
    });
  });

  return clusters;
}

// ---------------------------------------------------------------------
// masking helpers (moved here from the deleted mock riskEngine.js)
// ---------------------------------------------------------------------
export function maskAccount(acc = "") {
  const s = String(acc);
  if (s.length <= 4) return s;
  return "XXXX XXXX " + s.slice(-4);
}

export function maskPhone(phone = "") {
  const s = String(phone);
  if (s.length <= 4) return s;
  return s.slice(0, 2) + "XXXXXX" + s.slice(-2);
}
