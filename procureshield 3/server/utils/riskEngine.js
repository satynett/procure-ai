// riskEngine.js
// Core, fully deterministic relationship-detection & risk-scoring logic.
// This is NOT proof of wrongdoing - it produces a "Relationship Risk /
// Review Priority" score that always requires human review.

export const WEIGHTS = {
  sharedDirector: 30,
  sharedAddress: 20,
  sharedPhone: 15,
  sharedBank: 35,
  similarGstPan: 10,
  similarBiddingBehavior: 10,
};

function normalize(str = "") {
  return String(str).toLowerCase().trim().replace(/\s+/g, " ");
}

// crude address-similarity: normalize + compare the "core" tokens
function addressSimilar(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = new Set(na.split(/[, ]+/).filter((t) => t.length > 2));
  const tb = new Set(nb.split(/[, ]+/).filter((t) => t.length > 2));
  let overlap = 0;
  ta.forEach((t) => {
    if (tb.has(t)) overlap++;
  });
  const minSize = Math.min(ta.size, tb.size) || 1;
  return overlap / minSize >= 0.6;
}

function gstPanSimilar(a, b) {
  // Similar if the state-code prefix of GST matches, or PAN 4th-char (entity type) + surname chunk matches
  const gstA = (a.gst_number || "").slice(0, 2);
  const gstB = (b.gst_number || "").slice(0, 2);
  const panA = (a.pan_number || "").slice(0, 5);
  const panB = (b.pan_number || "").slice(0, 5);
  return (gstA && gstA === gstB && a.bidder_id !== b.bidder_id) || (panA && panA === panB);
}

function biddingBehaviorSimilar(a, b) {
  // Similar if they frequently bid on the same tender categories within close timing
  const catsA = new Set((a.bids || []).map((x) => x.category));
  const catsB = new Set((b.bids || []).map((x) => x.category));
  let overlap = 0;
  catsA.forEach((c) => {
    if (catsB.has(c)) overlap++;
  });
  return overlap >= 2;
}

/**
 * Compare two bidders and return the signals + weighted score between them.
 */
export function compareBidders(a, b) {
  const signals = {
    sharedDirector: normalize(a.director_name) === normalize(b.director_name) && !!a.director_name,
    sharedAddress: addressSimilar(a.address, b.address),
    sharedPhone: !!a.phone && a.phone === b.phone,
    sharedBank: !!a.bank_account && a.bank_account === b.bank_account,
    similarGstPan: gstPanSimilar(a, b),
    similarBiddingBehavior: biddingBehaviorSimilar(a, b),
  };

  let score = 0;
  const evidence = [];
  for (const key of Object.keys(signals)) {
    if (signals[key]) {
      score += WEIGHTS[key];
      evidence.push(key);
    }
  }
  score = Math.max(0, Math.min(100, score));

  return { score, signals, evidence };
}

export function riskCategory(score) {
  if (score >= 81) return "Critical";
  if (score >= 61) return "High";
  if (score >= 31) return "Medium";
  return "Low";
}

/**
 * Build the full relationship graph + connected "clusters" (suspicious groups)
 * across the full bidder list. Two bidders are linked if their pairwise score > 0.
 */
// Only these "strong" identity signals are allowed to merge two bidders into
// the same suspicious cluster. Weaker signals (similar GST/PAN prefix, similar
// bidding behaviour) still contribute to a pair's score and are still shown
// as evidence, but on their own they are common/coincidental enough among
// unrelated bidders that they must not, by themselves, link bidders into a
// network - that would produce false positives and erode officer trust.
const STRONG_SIGNALS = ["sharedDirector", "sharedAddress", "sharedPhone", "sharedBank"];

export function buildRelationshipGraph(bidders) {
  const edges = [];
  for (let i = 0; i < bidders.length; i++) {
    for (let j = i + 1; j < bidders.length; j++) {
      const { score, signals, evidence } = compareBidders(bidders[i], bidders[j]);
      const hasStrongSignal = evidence.some((e) => STRONG_SIGNALS.includes(e));
      if (score > 0) {
        edges.push({
          source: bidders[i].bidder_id,
          target: bidders[j].bidder_id,
          score,
          signals,
          evidence,
          linkable: hasStrongSignal,
        });
      }
    }
  }

  // Union-Find to build connected components (clusters)
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

  bidders.forEach((b) => find(b.bidder_id));
  edges.filter((e) => e.linkable).forEach((e) => union(e.source, e.target));

  const groups = {};
  bidders.forEach((b) => {
    const root = find(b.bidder_id);
    if (!groups[root]) groups[root] = [];
    groups[root].push(b.bidder_id);
  });

  const clusters = Object.values(groups)
    .filter((members) => members.length > 1)
    .map((members, idx) => {
      const clusterEdges = edges.filter(
        (e) => members.includes(e.source) && members.includes(e.target)
      );
      const maxScore = clusterEdges.reduce((m, e) => Math.max(m, e.score), 0);
      // aggregate evidence across the cluster (union of signal types found)
      const evidenceSet = new Set();
      clusterEdges.forEach((e) => e.evidence.forEach((ev) => evidenceSet.add(ev)));
      return {
        cluster_id: `CLU-${String(idx + 1).padStart(2, "0")}`,
        members,
        edges: clusterEdges,
        risk_score: maxScore,
        risk_category: riskCategory(maxScore),
        evidence: Array.from(evidenceSet),
      };
    })
    .sort((a, b) => b.risk_score - a.risk_score)
    .map((c, idx) => ({ ...c, cluster_id: `CLU-${String(idx + 1).padStart(2, "0")}` }));

  return { edges, clusters };
}

/**
 * Given the full bidder list, return a map bidder_id -> { score, category, clusterId }
 */
export function computeBidderRiskMap(bidders) {
  const { clusters } = buildRelationshipGraph(bidders);
  const map = {};
  bidders.forEach((b) => {
    map[b.bidder_id] = { score: 0, category: "Low", cluster_id: null };
  });
  clusters.forEach((c) => {
    c.members.forEach((m) => {
      map[m] = { score: c.risk_score, category: c.risk_category, cluster_id: c.cluster_id };
    });
  });
  return map;
}

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
