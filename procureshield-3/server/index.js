// index.js
// ProcureShield BFF.
//
// This server owns the things a demo UI needs and the analytics engine
// deliberately does not: authentication, the officer verification workflow,
// the audit log, CSV/report shaping, and the GeM-shaped demo dataset.
//
// It owns NO risk logic. Every score, signal, relationship, cluster and
// explanation shown in the UI is produced by the ProcureShield Engine (the
// Python FastAPI service in ../engine) and reaches the client through
// utils/engineClient.js. The previous mock riskEngine.js / aiEngine.js have
// been removed.

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import {
  analyze,
  companyDetail,
  egoNetwork,
  engineUrl,
  intelligencePdf,
  intelligenceValidateDocument,
  intelligenceRequirements,
  intelligenceEligibility,
  invalidateCache,
  status as engineStatus,
  tenderDetail,
  train as engineTrain,
  EngineUnavailableError,
} from "./utils/engineClient.js";
import {
  maskAccount,
  maskPhone,
  riskCategory,
  signalLabel,
} from "./utils/engineMapping.js";
import { registryEvidenceFor } from "./utils/registrySignals.js";
import { buildChecklist } from "./utils/checklist.js";
import { toCsv } from "./utils/csv.js";
import { requireAuth, DEMO_TOKEN } from "./middleware/auth.js";
import { rateLimit } from "./middleware/rateLimit.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

const app = express();
app.set("trust proxy", true);
app.use(cors());
app.use(express.json());
app.use(requireAuth);

const VALID_VERIFICATION_STATUSES = ["Verified", "Needs Review", "Rejected"];
const MAX_COMMENT_LENGTH = 1000;

// ---------------------------------------------------------------------
// Data access helpers (JSON-file "database" for the prototype)
// ---------------------------------------------------------------------
function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
}
function writeJson(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}
function getBidders() {
  return readJson("bidders.json");
}
function getBids() {
  return readJson("bids.json");
}
function getTenders() {
  try {
    return readJson("tenders.json");
  } catch {
    return [];
  }
}

function decorateTender(tender, bids, bidders) {
  const tenderBids = bids.filter((b) => b.tender_id === tender.tender_id);
  const winnerBid = tender.status === "Awarded" && tenderBids.length
    ? tenderBids.slice().sort((a, b) => Number(a.bid_amount || Infinity) - Number(b.bid_amount || Infinity))[0]
    : null;
  const winner = winnerBid ? bidders.find((b) => b.bidder_id === winnerBid.bidder_id) : null;
  return {
    ...tender,
    bid_count: tenderBids.length,
    winner_name: winner?.company_name || null,
    winner_bid_id: winnerBid?.bid_id || null,
    award_amount: winnerBid?.bid_amount || null,
  };
}

function getAuditLog() {
  try {
    return readJson("auditLog.json");
  } catch {
    return [];
  }
}
function appendAuditLog(entry) {
  const log = getAuditLog();
  log.unshift(entry);
  writeJson("auditLog.json", log);
  return log;
}

function maskBidder(b) {
  return {
    ...b,
    phone_masked: maskPhone(b.phone),
    bank_account_masked: maskAccount(b.bank_account),
  };
}

// ---------------------------------------------------------------------
// Engine access
//
// Every analytics route goes through here. `asyncRoute` turns an engine
// outage into a clean 503 naming the engine URL, so an officer sees "the
// engine is not running" instead of a screen full of zeros.
// ---------------------------------------------------------------------
async function getAnalysis(opts = {}) {
  return analyze(getBidders(), getBids(), opts);
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

/** Decorate a stored bid with its bidder and the engine's risk score. */
function decorateBid(bid, bidders, view) {
  const bidder = bidders.find((b) => b.bidder_id === bid.bidder_id);
  const risk = view.riskMap[bid.bidder_id] || { score: 0, category: "Low" };
  return {
    ...bid,
    bidder_name: bid.bidder_company_name || (bidder ? bidder.company_name : "Unknown"),
    msme_status: bidder ? bidder.msme_status : "Unknown",
    // The engine scores companies, not individual bids: a bid inherits the
    // risk of the bidder that submitted it. Any stored `risk_score` in
    // bids.json is overwritten so there is a single source of truth.
    risk_score: risk.score,
    risk_category: risk.category,
    cluster_id: risk.cluster_id || null,
  };
}

// ---------------------------------------------------------------------
// Auth (demo only - NOT production authentication)
// ---------------------------------------------------------------------
app.post("/api/auth/login", rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  const { username, password } = req.body || {};
  const expectedUser = process.env.DEMO_USERNAME || "admin";
  const expectedPass = process.env.DEMO_PASSWORD || "admin123";
  if (username === expectedUser && password === expectedPass) {
    return res.json({
      success: true,
      token: DEMO_TOKEN,
      officer: { name: "Procurement Officer 01", role: "Procurement Officer", org: "GeM Demo Cell" },
    });
  }
  return res.status(401).json({ success: false, message: "Invalid demo credentials." });
});

// ---------------------------------------------------------------------
// Engine control surface
// ---------------------------------------------------------------------
app.get("/api/engine/status", asyncRoute(async (req, res) => {
  res.json(await engineStatus());
}));

app.post("/api/engine/refresh", asyncRoute(async (req, res) => {
  invalidateCache();
  const view = await getAnalysis({ force: true, train: Boolean(req.body?.train) });
  res.json({
    success: true,
    analysis_id: view.headline.analysis_id,
    mode: view.headline.mode,
    clusters: view.clusters.length,
    flagged: view.flagged,
    disclaimer: view.disclaimer,
  });
}));

app.post("/api/engine/train", asyncRoute(async (req, res) => {
  await getAnalysis();
  const result = await engineTrain({
    reuse_last_analysis: true,
    ...(req.body?.epochs ? { epochs: req.body.epochs } : {}),
    ...(req.body?.seed !== undefined ? { seed: req.body.seed } : {}),
  });
  invalidateCache();
  res.json(result);
}));

// ---------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------
app.get("/api/dashboard", asyncRoute(async (req, res) => {
  const bidders = getBidders();
  const view = await getAnalysis();
  const bids = getBids().map((b) => decorateBid(b, bidders, view));

  const verified = bids.filter((b) => b.verification_status === "Verified").length;
  const needsReview = bids.filter((b) => b.verification_status === "Needs Review").length;
  const rejected = bids.filter((b) => b.verification_status === "Rejected").length;

  // Signal rollup straight from the engine, so the dashboard shows which
  // patterns actually fired rather than a synthetic trend line.
  const signalTrend = view.signalRollup.map((s) => ({
    code: s.code,
    label: signalLabel(s.code),
    count: s.companies_flagged,
    mean_severity: s.mean_severity,
  }));

  res.json({
    demo: true,
    engine: {
      mode: view.headline.mode,
      analysis_id: view.headline.analysis_id,
      model_probability: view.headline.model_probability,
      headline_risk: view.headline.risk_score,
      headline_level: view.headline.risk_level,
      explanation: view.headline.explanation,
      graph_stats: view.graph.stats,
    },
    stats: {
      totalBids: bids.length,
      verifiedBids: verified,
      bidsNeedingReview: needsReview,
      highRiskBids: bids.filter((b) => b.risk_score > 50).length,
      potentialNetworks: view.clusters.length,
      flaggedBidders: view.flagged,
    },
    verificationStatus: [
      { name: "Verified", value: verified },
      { name: "Needs Review", value: needsReview },
      { name: "Rejected", value: rejected },
    ],
    riskDistribution: [
      { name: "Low", value: bids.filter((b) => b.risk_score <= 25).length },
      { name: "Medium", value: bids.filter((b) => b.risk_score > 25 && b.risk_score <= 50).length },
      { name: "High", value: bids.filter((b) => b.risk_score > 50 && b.risk_score <= 75).length },
      { name: "Critical", value: bids.filter((b) => b.risk_score > 75).length },
    ],
    signalTrend,
    disclaimer: view.disclaimer,
  });
}));


// ---------------------------------------------------------------------
// Shared tender lifecycle for bidder + officer portals
// ---------------------------------------------------------------------
app.get("/api/tenders", asyncRoute(async (req, res) => {
  const bidders = getBidders();
  const bids = getBids();
  const tenders = getTenders().map((t) => decorateTender(t, bids, bidders));
  const status = req.query.status;
  const filtered = status ? tenders.filter((t) => t.status.toLowerCase() === String(status).toLowerCase()) : tenders;
  res.json({
    tenders: filtered,
    counts: {
      open: tenders.filter((t) => t.status === "Open").length,
      awarded: tenders.filter((t) => t.status === "Awarded").length,
    },
    disclaimer: "Demo tender lifecycle; data is synthetic sandbox data."
  });
}));

app.get("/api/tenders/:id", asyncRoute(async (req, res) => {
  const bidders = getBidders();
  const bids = getBids();
  const tenderId = decodeURIComponent(req.params.id);
  const tender = getTenders().find((t) => t.tender_id === tenderId);
  if (!tender) return res.status(404).json({ message: "Tender not found" });
  res.json({ tender: decorateTender(tender, bids, bidders) });
}));

app.post("/api/bidder/bids", (req, res) => {
  const { tender_id, company_name, documents = [], bid_amount = null } = req.body || {};
  const tender = getTenders().find((t) => t.tender_id === tender_id);
  if (!tender || tender.status !== "Open") return res.status(400).json({ message: "This tender is not open for bidding." });
  if (!company_name?.trim()) return res.status(400).json({ message: "Company name is required." });

  const bids = getBids();
  const sequence = bids.length + 1;
  const bid = {
    bid_id: `DEMO/BID/2026/${String(sequence).padStart(4, "0")}`,
    tender_id,
    bidder_id: "BID-1001",
    bidder_company_name: company_name.trim(),
    category: tender.category,
    bid_amount: bid_amount ? Number(bid_amount) : null,
    submission_date: new Date().toISOString().slice(0, 10),
    verification_status: "Needs Review",
    submitted_documents: documents.map((d) => typeof d === "string" ? d : d.name).filter(Boolean),
  };
  bids.push(bid);
  writeJson("bids.json", bids);
  res.status(201).json({ success: true, bid });
});

// ---------------------------------------------------------------------
// Bids
// ---------------------------------------------------------------------
const BID_SORT_FIELDS = {
  submission_date: (b) => b.submission_date,
  risk_score: (b) => b.risk_score,
  bidder_name: (b) => b.bidder_name.toLowerCase(),
  bid_id: (b) => b.bid_id,
};

function filterBids(bids, bidders, query) {
  const { q, status, risk, category, from, to } = query;
  let out = bids;
  if (q) {
    const needle = String(q).toLowerCase();
    out = out.filter((b) => {
      const bidder = bidders.find((x) => x.bidder_id === b.bidder_id);
      return (
        b.bid_id.toLowerCase().includes(needle) ||
        b.tender_id.toLowerCase().includes(needle) ||
        b.bidder_name.toLowerCase().includes(needle) ||
        (bidder &&
          (bidder.director_name.toLowerCase().includes(needle) ||
            bidder.gst_number.toLowerCase().includes(needle) ||
            bidder.pan_number.toLowerCase().includes(needle) ||
            bidder.address.toLowerCase().includes(needle)))
      );
    });
  }
  if (status) out = out.filter((b) => b.verification_status === status);
  if (risk) out = out.filter((b) => b.risk_category === risk);
  if (category) out = out.filter((b) => b.category === category);
  if (from) out = out.filter((b) => b.submission_date >= from);
  if (to) out = out.filter((b) => b.submission_date <= to);
  return out;
}

app.get("/api/bids", asyncRoute(async (req, res) => {
  const bidders = getBidders();
  const view = await getAnalysis();
  let bids = filterBids(
    getBids().map((b) => decorateBid(b, bidders, view)),
    bidders,
    req.query
  );

  const { sortBy, sortDir, page, pageSize } = req.query;
  const sortKey = BID_SORT_FIELDS[sortBy] ? sortBy : "submission_date";
  const dir = sortDir === "asc" ? 1 : -1;
  const getSortVal = BID_SORT_FIELDS[sortKey];
  bids.sort((a, b) => {
    const va = getSortVal(a);
    const vb = getSortVal(b);
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });

  const total = bids.length;
  let pageInfo = null;
  if (page || pageSize) {
    const sizeNum = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 20));
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const startIdx = (pageNum - 1) * sizeNum;
    bids = bids.slice(startIdx, startIdx + sizeNum);
    pageInfo = { page: pageNum, pageSize: sizeNum, totalPages: Math.max(1, Math.ceil(total / sizeNum)) };
  }

  res.json({ count: total, bids, ...(pageInfo ? { pageInfo } : {}) });
}));

app.get("/api/bids/export.csv", asyncRoute(async (req, res) => {
  const bidders = getBidders();
  const view = await getAnalysis();
  const bids = filterBids(
    getBids().map((b) => decorateBid(b, bidders, view)),
    bidders,
    req.query
  );

  const rows = bids.map((b) => ({
    bid_id: b.bid_id,
    tender_id: b.tender_id,
    bidder_name: b.bidder_name,
    category: b.category,
    submission_date: b.submission_date,
    verification_status: b.verification_status,
    risk_score: b.risk_score,
    risk_category: b.risk_category,
    msme_status: b.msme_status,
  }));
  res.set("Content-Type", "text/csv");
  res.set("Content-Disposition", `attachment; filename="procureshield-bids-${Date.now()}.csv"`);
  res.send(toCsv(rows));
}));

app.get("/api/bids/:id", asyncRoute(async (req, res) => {
  const bidders = getBidders();
  const bidId = decodeURIComponent(req.params.id);
  const bid = getBids().find((b) => b.bid_id === bidId);
  if (!bid) return res.status(404).json({ message: "Bid not found" });

  const bidder = bidders.find((b) => b.bidder_id === bid.bidder_id);
  const view = await getAnalysis();
  const risk = view.riskMap[bid.bidder_id] || {
    score: 0,
    category: "Low",
    signals: [],
    explanation: "",
    recommended_actions: [],
  };

  const bidderEdges = view.edges.filter(
    (e) => e.source === bidder.bidder_id || e.target === bidder.bidder_id
  );
  const evidenceForBidder = Array.from(
    new Set([
      ...bidderEdges.flatMap((e) => e.evidence),
      ...risk.signals.map((s) => s.ui_code),
      ...registryEvidenceFor(bidder.bidder_id, view.registryEdges),
    ])
  );

  // Tender-level context comes from the engine too, when it knows the tender.
  let tender = null;
  try {
    tender = await tenderDetail(bid.tender_id);
  } catch (err) {
    // Tender context is supplementary: the bid view still works without it.
    // Log rather than swallow, so a broken lookup is visible in the server
    // output instead of silently rendering an empty panel.
    console.warn(`Tender lookup failed for ${bid.tender_id}: ${err.message}`);
    tender = null;
  }

  res.json({
    bid: decorateBid(bid, bidders, view),
    bidder: maskBidder(bidder),
    checklist: buildChecklist({ bidder, bid, evidenceForBidder }),
    riskAssessment: {
      score: risk.score,
      category: risk.category,
      explanation: risk.explanation,
      recommended_actions: risk.recommended_actions,
      model_probability: risk.model_probability ?? null,
      signals: risk.signals,
      requires_human_investigation: true,
    },
    tender,
    relatedEdges: bidderEdges.map((e) => {
      const otherId = e.source === bidder.bidder_id ? e.target : e.source;
      const other = bidders.find((x) => x.bidder_id === otherId);
      return {
        bidder_id: otherId,
        company_name: other ? other.company_name : otherId,
        score: e.score,
        evidence: e.evidence,
        reasons: e.reasons,
        linkable: e.linkable,
      };
    }),
    disclaimer: view.disclaimer,
  });
}));

// ---------------------------------------------------------------------
// Bidders
// ---------------------------------------------------------------------
app.get("/api/bidders", asyncRoute(async (req, res) => {
  const view = await getAnalysis();
  const bidders = getBidders().map((b) => ({
    ...maskBidder(b),
    risk_score: view.riskMap[b.bidder_id]?.score ?? 0,
    risk_category: view.riskMap[b.bidder_id]?.category ?? "Low",
    cluster_id: view.riskMap[b.bidder_id]?.cluster_id ?? null,
  }));
  res.json({ count: bidders.length, bidders });
}));

app.get("/api/bidders/:id", asyncRoute(async (req, res) => {
  const bidders = getBidders();
  const bidder = bidders.find((b) => b.bidder_id === req.params.id);
  if (!bidder) return res.status(404).json({ message: "Bidder not found" });

  const view = await getAnalysis();
  const risk = view.riskMap[bidder.bidder_id] || {};
  const bids = getBids()
    .filter((b) => b.bidder_id === bidder.bidder_id)
    .map((b) => decorateBid(b, bidders, view));

  // Full engine profile (features, tender history, every signal).
  let profile = null;
  try {
    profile = await companyDetail(bidder.bidder_id);
  } catch (err) {
    console.warn(`Company profile lookup failed for ${bidder.bidder_id}: ${err.message}`);
    profile = null;
  }

  res.json({
    bidder: {
      ...maskBidder(bidder),
      risk_score: risk.score ?? 0,
      risk_category: risk.category ?? "Low",
      cluster_id: risk.cluster_id ?? null,
    },
    bids,
    riskAssessment: {
      explanation: risk.explanation || "",
      recommended_actions: risk.recommended_actions || [],
      signals: risk.signals || [],
    },
    profile,
    disclaimer: view.disclaimer,
  });
}));

// ---------------------------------------------------------------------
// Network / relationship graph
// ---------------------------------------------------------------------
function networkNodes(bidders, view) {
  return bidders.map((b) => ({
    ...maskBidder(b),
    risk_score: view.riskMap[b.bidder_id]?.score ?? 0,
    risk_category: view.riskMap[b.bidder_id]?.category ?? "Low",
    cluster_id: view.riskMap[b.bidder_id]?.cluster_id ?? null,
  }));
}

app.get("/api/network", asyncRoute(async (req, res) => {
  const view = await getAnalysis();
  res.json({
    nodes: networkNodes(getBidders(), view),
    edges: view.edges.filter((e) => e.linkable),
    clusters: view.clusters,
    engine: {
      mode: view.headline.mode,
      graph_stats: view.graph.stats,
      analysis_id: view.headline.analysis_id,
    },
    disclaimer: view.disclaimer,
  });
}));

app.get("/api/network/cluster/:clusterId", asyncRoute(async (req, res) => {
  const view = await getAnalysis();
  const cluster = view.clusters.find((c) => c.cluster_id === req.params.clusterId);
  if (!cluster) return res.status(404).json({ message: "Cluster not found" });
  const members = networkNodes(
    getBidders().filter((b) => cluster.members.includes(b.bidder_id)),
    view
  );
  res.json({ cluster, members, disclaimer: view.disclaimer });
}));

app.get("/api/network/:bidderId", asyncRoute(async (req, res) => {
  const bidders = getBidders();
  const bidderId = req.params.bidderId;
  if (!bidders.some((b) => b.bidder_id === bidderId)) {
    return res.status(404).json({ message: "Bidder not found" });
  }

  const view = await getAnalysis();
  const relatedEdges = view.edges.filter((e) => e.source === bidderId || e.target === bidderId);
  const relatedIds = new Set([bidderId]);
  relatedEdges.forEach((e) => {
    relatedIds.add(e.source);
    relatedIds.add(e.target);
  });

  // The engine's own ego network (companies, tenders, people, addresses)
  // is richer than the bidder-to-bidder projection, so both are returned.
  let ego = null;
  try {
    ego = await egoNetwork(bidderId, Number(req.query.depth) || 1);
  } catch (err) {
    console.warn(`Ego network lookup failed for ${bidderId}: ${err.message}`);
    ego = null;
  }

  res.json({
    nodes: networkNodes(bidders.filter((b) => relatedIds.has(b.bidder_id)), view),
    edges: relatedEdges,
    cluster: view.clusters.find((c) => c.members.includes(bidderId)) || null,
    ego,
    disclaimer: view.disclaimer,
  });
}));

// ---------------------------------------------------------------------
// Alerts - derived from engine signals, not from hard-coded templates
// ---------------------------------------------------------------------
const SEVERITY_FOR = (category) =>
  category === "Critical" ? "red" : category === "High" ? "orange" : "yellow";

app.get("/api/alerts", asyncRoute(async (req, res) => {
  const bidders = getBidders();
  const view = await getAnalysis();
  const nameOf = (id) => bidders.find((b) => b.bidder_id === id)?.company_name || id;
  const minScore = req.query.min_score !== undefined ? Number(req.query.min_score) : 50;
  const bids = getBids();

  const alerts = [];

  // One alert per cluster per distinct engine signal driving it.
  view.clusters.forEach((cluster) => {
    const memberNames = cluster.members.map(nameOf).join(", ");
    cluster.signal_breakdown.slice(0, 4).forEach((signal) => {
      alerts.push({
        id: `AL-${cluster.cluster_id}-${signal.code}`,
        severity: SEVERITY_FOR(cluster.risk_category),
        title: signal.label,
        description:
          `${signal.label} detected across ${cluster.members.length} bidders (${memberNames}). ` +
          `Pattern strength ${(signal.severity * 100).toFixed(0)}%. This is a review priority, ` +
          `not a finding of wrongdoing.`,
        cluster_id: cluster.cluster_id,
        signal_code: signal.code,
        risk_score: cluster.risk_score,
        date: null,
        bid_id: null,
      });
    });
  });

  // One alert per bidder at or above the threshold, carrying its top signal.
  Object.entries(view.riskMap)
    .filter(([, risk]) => risk.score >= minScore)
    .sort((a, b) => b[1].score - a[1].score)
    .forEach(([bidderId, risk]) => {
      const top = risk.signals[0];
      const firstBid = bids.find((b) => b.bidder_id === bidderId);
      alerts.push({
        id: `AL-${bidderId}`,
        severity: SEVERITY_FOR(risk.category),
        title: `Elevated relationship risk: ${nameOf(bidderId)}`,
        description: top
          ? `${top.label} - ${top.description}`
          : `Scored ${risk.score}/100 by the ProcureShield engine; manual verification required.`,
        cluster_id: risk.cluster_id,
        signal_code: top?.ui_code || null,
        risk_score: risk.score,
        date: firstBid?.submission_date || null,
        bid_id: firstBid?.bid_id || null,
      });
    });

  alerts.sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0));
  res.json({ count: alerts.length, threshold: minScore, alerts, disclaimer: view.disclaimer });
}));

// ---------------------------------------------------------------------
// Verification workflow (human-in-the-loop)
// ---------------------------------------------------------------------
async function applyVerificationAction(bidId, newStatus, action, comment, res) {
  if (!VALID_VERIFICATION_STATUSES.includes(newStatus)) {
    return res.status(400).json({ message: "Invalid verification status." });
  }
  if (comment && String(comment).length > MAX_COMMENT_LENGTH) {
    return res.status(400).json({ message: `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer.` });
  }

  const bids = getBids();
  const idx = bids.findIndex((b) => b.bid_id === bidId);
  if (idx === -1) return res.status(404).json({ message: "Bid not found" });

  const previousStatus = bids[idx].verification_status;
  bids[idx].verification_status = newStatus;
  writeJson("bids.json", bids);

  const entry = {
    id: `AUD-${Date.now()}`,
    officer: "Procurement Officer 01",
    action,
    bid_id: bidId,
    timestamp: new Date().toISOString(),
    previous_status: previousStatus,
    new_status: newStatus,
    comment: comment || "",
  };
  const log = appendAuditLog(entry);

  // Verification status is an officer decision, not an engine input, so the
  // cached analysis stays valid and no re-run is triggered here.
  const view = await getAnalysis();
  res.json({
    success: true,
    bid: decorateBid(bids[idx], getBidders(), view),
    auditEntry: entry,
    auditLogCount: log.length,
  });
}

app.post("/api/verification/:bidId/review", asyncRoute((req, res) =>
  applyVerificationAction(req.params.bidId, "Needs Review", "Sent for Manual Review", req.body?.comment, res)));
app.post("/api/verification/:bidId/false-positive", asyncRoute((req, res) =>
  applyVerificationAction(req.params.bidId, "Verified", "Marked as False Positive", req.body?.comment, res)));
app.post("/api/verification/:bidId/escalate", asyncRoute((req, res) =>
  applyVerificationAction(req.params.bidId, "Needs Review", "Escalated", req.body?.comment, res)));
app.post("/api/verification/:bidId/confirm", asyncRoute((req, res) =>
  applyVerificationAction(req.params.bidId, "Verified", "Confirmed & Closed", req.body?.comment, res)));

// ---------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------
app.get("/api/audit-log", (req, res) => {
  res.json({ log: getAuditLog() });
});

// ---------------------------------------------------------------------
// Explanation endpoint
//
// This replaces the old mock "AI engine". No text is generated here and no
// LLM is called: the engine already produces hedged, signal-traceable
// explanations, and this route selects the right one. Every sentence the UI
// shows is therefore traceable to a computed signal.
// ---------------------------------------------------------------------
app.post("/api/intelligence/pdf", asyncRoute(async (req, res) => {
  res.json(await intelligencePdf(req.body));
}));

app.post("/api/intelligence/requirements", asyncRoute(async (req, res) => {
  res.json(await intelligenceRequirements(req.body));
}));

app.post("/api/intelligence/validate-document", asyncRoute(async (req, res) => {
  res.json(await intelligenceValidateDocument(req.body));
}));

app.post("/api/intelligence/eligibility", asyncRoute(async (req, res) => {
  res.json(await intelligenceEligibility(req.body));
}));

app.post("/api/ai/analyze", asyncRoute(async (req, res) => {
  const { mode, payload } = req.body || {};
  const view = await getAnalysis();
  const bidders = getBidders();
  const nameOf = (id) => bidders.find((b) => b.bidder_id === id)?.company_name || id;

  if (mode === "relationship") {
    const edge = view.edges.find(
      (e) =>
        (e.source === payload?.bidderA && e.target === payload?.bidderB) ||
        (e.source === payload?.bidderB && e.target === payload?.bidderA)
    );
    if (!edge) {
      return res.json({
        narrative:
          "No relationship signals were computed between these two bidders in the current dataset.",
        findings: [],
        source: "procureshield-engine",
        disclaimer: view.disclaimer,
      });
    }
    return res.json({
      narrative:
        `${nameOf(edge.source)} and ${nameOf(edge.target)}: ${edge.reasons.join("; ")}. ` +
        `Relationship indicator strength ${edge.score}/100. This relationship requires manual ` +
        `verification by an authorised officer and is not, by itself, evidence of wrongdoing.`,
      findings: edge.evidence.map((code) => ({ signal: code, text: signalLabel(code) })),
      score: edge.score,
      category: riskCategory(edge.score),
      source: "procureshield-engine",
      disclaimer: view.disclaimer,
    });
  }

  if (mode === "checklist") {
    const risk = view.riskMap[payload?.bidderId];
    const match = risk?.signals.find((s) => s.ui_code === payload?.signalCode);
    return res.json({
      text: match
        ? match.description
        : `${payload?.item || "This check"} completed against the structured data supplied with the bid.`,
      confidence: payload?.confidence ?? null,
      source: "procureshield-engine",
      disclaimer: view.disclaimer,
    });
  }

  if (mode === "investigation_summary") {
    const cluster = view.clusters.find((c) => c.cluster_id === payload?.clusterId);
    if (!cluster) return res.status(404).json({ message: "Cluster not found" });
    const members = cluster.members.map(nameOf);
    const topMember = cluster.members
      .map((m) => view.riskMap[m])
      .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];
    return res.json({
      narrative:
        `${cluster.cluster_id}: ${members.length} bidders (${members.join(", ")}) form one connected ` +
        `relationship group. Highest member score ${cluster.risk_score}/100 ` +
        `(${cluster.risk_category} review priority). ${topMember?.explanation || ""}`.trim(),
      evidence: cluster.evidence,
      signal_breakdown: cluster.signal_breakdown,
      recommended_actions: topMember?.recommended_actions || [],
      riskScore: cluster.risk_score,
      category: cluster.risk_category,
      source: "procureshield-engine",
      disclaimer: view.disclaimer,
    });
  }

  return res.status(400).json({ message: "Unknown analysis mode" });
}));

// ---------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------
app.get("/api/reports/:type", asyncRoute(async (req, res) => {
  const bidders = getBidders();
  const view = await getAnalysis();
  const bids = getBids().map((b) => decorateBid(b, bidders, view));
  const nameOf = (id) => bidders.find((b) => b.bidder_id === id)?.company_name || id;
  const generatedAt = new Date().toISOString();
  const type = req.params.type;
  const base = { type, generatedAt, engine: view.headline, disclaimer: view.disclaimer };

  if (type === "bid-verification") {
    return res.json({
      ...base,
      title: "Bid Verification Report",
      summary: {
        total: bids.length,
        verified: bids.filter((b) => b.verification_status === "Verified").length,
        needsReview: bids.filter((b) => b.verification_status === "Needs Review").length,
        rejected: bids.filter((b) => b.verification_status === "Rejected").length,
      },
      rows: bids.map((b) => ({
        bid_id: b.bid_id,
        bidder: b.bidder_name,
        status: b.verification_status,
        risk_score: b.risk_score,
      })),
    });
  }
  if (type === "bidder-network") {
    return res.json({
      ...base,
      title: "Bidder Network Report",
      clusters: view.clusters.map((c) => ({
        cluster_id: c.cluster_id,
        members: c.members.map(nameOf),
        risk_score: c.risk_score,
        risk_category: c.risk_category,
        evidence: c.evidence,
        signal_breakdown: c.signal_breakdown,
      })),
    });
  }
  if (type === "risk-analysis") {
    return res.json({
      ...base,
      title: "Risk Analysis Report",
      distribution: {
        low: bids.filter((b) => b.risk_score <= 25).length,
        medium: bids.filter((b) => b.risk_score > 25 && b.risk_score <= 50).length,
        high: bids.filter((b) => b.risk_score > 50 && b.risk_score <= 75).length,
        critical: bids.filter((b) => b.risk_score > 75).length,
      },
      signalRollup: view.signalRollup.map((s) => ({ ...s, label: signalLabel(s.code) })),
      topRiskBids: bids
        .slice()
        .sort((a, b) => b.risk_score - a.risk_score)
        .slice(0, 10)
        .map((b) => ({ bid_id: b.bid_id, bidder: b.bidder_name, risk_score: b.risk_score })),
    });
  }
  if (type === "investigation-summary") {
    return res.json({
      ...base,
      title: "Investigation Summary",
      clusters: view.clusters.map((c) => ({
        cluster_id: c.cluster_id,
        members: c.members.map(nameOf),
        risk_score: c.risk_score,
        evidence: c.evidence,
      })),
      recentAuditActions: getAuditLog().slice(0, 15),
    });
  }
  res.status(400).json({ message: "Unknown report type" });
}));

app.get("/api/reports/:type/csv", asyncRoute(async (req, res) => {
  const bidders = getBidders();
  const view = await getAnalysis();
  const bids = getBids().map((b) => decorateBid(b, bidders, view));
  const type = req.params.type;

  let rows, columns;
  if (type === "bid-verification") {
    rows = bids.map((b) => ({
      bid_id: b.bid_id,
      bidder: b.bidder_name,
      status: b.verification_status,
      risk_score: b.risk_score,
    }));
    columns = ["bid_id", "bidder", "status", "risk_score"];
  } else if (type === "risk-analysis") {
    rows = bids
      .slice()
      .sort((a, b) => b.risk_score - a.risk_score)
      .map((b) => ({
        bid_id: b.bid_id,
        bidder: b.bidder_name,
        risk_score: b.risk_score,
        risk_category: b.risk_category,
      }));
    columns = ["bid_id", "bidder", "risk_score", "risk_category"];
  } else {
    return res.status(400).json({
      message: "CSV export is only available for bid-verification and risk-analysis reports.",
    });
  }

  res.set("Content-Type", "text/csv");
  res.set("Content-Disposition", `attachment; filename="procureshield-${type}-${Date.now()}.csv"`);
  res.send(toCsv(rows, columns));
}));

// ---------------------------------------------------------------------
app.get("/api/health", asyncRoute(async (req, res) => {
  const engine = await engineStatus();
  res.json({ status: "ok", demo: true, engine });
}));

app.use("/api", (req, res) => {
  res.status(404).json({ message: `No route for ${req.method} ${req.originalUrl}` });
});

// In the container image the built React client is copied to ./public and
// served from here, so one origin serves both the SPA and the API. In local
// development Vite serves the client on :5173 and proxies /api, and this
// directory does not exist.
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  app.get("*", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
}

app.use((err, req, res, next) => {
  if (err instanceof EngineUnavailableError) {
    return res.status(503).json({ message: err.message, engine_url: engineUrl() });
  }
  console.error("Unhandled server error:", err);
  res.status(err.status || 500).json({ message: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 4000;

export { app };

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`ProcureShield BFF (SANDBOX/DEMO DATA) on http://localhost:${PORT}`);
    console.log(`Analytics engine: ${engineUrl()}`);
  });
}
