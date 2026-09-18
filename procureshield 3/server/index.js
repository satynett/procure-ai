import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import {
  buildRelationshipGraph,
  computeBidderRiskMap,
  riskCategory,
  maskAccount,
  maskPhone,
  WEIGHTS,
} from "./utils/riskEngine.js";
import { buildChecklist } from "./utils/checklist.js";
import { analyzeRelationship, explainChecklistItem, summarizeInvestigation, DISCLAIMER } from "./utils/aiEngine.js";
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

// The backend now enforces auth itself (previously only the React router
// gated access, so any tool could call the API directly with no
// credentials at all). Every route below requires the demo bearer token
// except /api/auth/login and /api/health.
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
function getAuditLog() {
  try {
    return readJson("auditLog.json");
  } catch {
    return [];
  }
}
function appendAuditLog(entry) {
  const log = getAuditLog();
  log.unshift(entry); // newest first
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

function bidWithBidder(bid, bidders) {
  const bidder = bidders.find((b) => b.bidder_id === bid.bidder_id);
  return {
    ...bid,
    bidder_name: bidder ? bidder.company_name : "Unknown",
    msme_status: bidder ? bidder.msme_status : "Unknown",
    risk_category: riskCategory(bid.risk_score),
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
// Dashboard
// ---------------------------------------------------------------------
app.get("/api/dashboard", (req, res) => {
  const bidders = getBidders();
  const bids = getBids();

  const total = bids.length;
  const verified = bids.filter((b) => b.verification_status === "Verified").length;
  const needsReview = bids.filter((b) => b.verification_status === "Needs Review").length;
  const rejected = bids.filter((b) => b.verification_status === "Rejected").length;
  const highRisk = bids.filter((b) => b.risk_score >= 61).length;

  const { clusters } = buildRelationshipGraph(bidders);

  // Suspicious pattern trend: deterministic pseudo-trend over last 30 days derived from cluster count & seed
  const trend = [];
  let seed = 7;
  for (let i = 29; i >= 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const rnd = seed / 233280;
    const base = clusters.length * 0.6;
    trend.push({
      day: i,
      count: Math.max(0, Math.round(base + rnd * 3 - 1)),
    });
  }

  res.json({
    demo: true,
    stats: {
      totalBids: total,
      verifiedBids: verified,
      bidsNeedingReview: needsReview,
      highRiskBids: highRisk,
      potentialNetworks: clusters.length,
      avgVerificationTimeMin: 3.2,
    },
    verificationStatus: [
      { name: "Verified", value: verified },
      { name: "Needs Review", value: needsReview },
      { name: "Rejected", value: rejected },
    ],
    riskDistribution: [
      { name: "Low", value: bids.filter((b) => b.risk_score <= 30).length },
      { name: "Medium", value: bids.filter((b) => b.risk_score > 30 && b.risk_score <= 60).length },
      { name: "High", value: bids.filter((b) => b.risk_score > 60 && b.risk_score <= 80).length },
      { name: "Critical", value: bids.filter((b) => b.risk_score > 80).length },
    ],
    suspiciousTrend: trend,
  });
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

app.get("/api/bids", (req, res) => {
  const bidders = getBidders();
  let bids = getBids().map((b) => bidWithBidder(b, bidders));

  const { q, status, risk, category, from, to, sortBy, sortDir, page, pageSize } = req.query;

  if (q) {
    const query = String(q).toLowerCase();
    bids = bids.filter((b) => {
      const bidder = bidders.find((x) => x.bidder_id === b.bidder_id);
      return (
        b.bid_id.toLowerCase().includes(query) ||
        b.tender_id.toLowerCase().includes(query) ||
        b.bidder_name.toLowerCase().includes(query) ||
        (bidder &&
          (bidder.director_name.toLowerCase().includes(query) ||
            bidder.gst_number.toLowerCase().includes(query) ||
            bidder.pan_number.toLowerCase().includes(query) ||
            bidder.address.toLowerCase().includes(query)))
      );
    });
  }
  if (status) bids = bids.filter((b) => b.verification_status === status);
  if (risk) bids = bids.filter((b) => b.risk_category === risk);
  if (category) bids = bids.filter((b) => b.category === category);
  if (from) bids = bids.filter((b) => b.submission_date >= from);
  if (to) bids = bids.filter((b) => b.submission_date <= to);

  // Sorting: defaults to newest-first by submission date (previous fixed
  // behaviour), but can now be overridden by the client.
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

  // Pagination is opt-in: omit `page`/`pageSize` to keep the previous
  // behaviour of returning the full filtered/sorted list.
  let pageInfo = null;
  if (page || pageSize) {
    const sizeNum = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 20));
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const startIdx = (pageNum - 1) * sizeNum;
    bids = bids.slice(startIdx, startIdx + sizeNum);
    pageInfo = { page: pageNum, pageSize: sizeNum, totalPages: Math.max(1, Math.ceil(total / sizeNum)) };
  }

  res.json({ count: total, bids, ...(pageInfo ? { pageInfo } : {}) });
});

// CSV export of the (filtered) bid list - same query params as /api/bids,
// pagination ignored so the export always contains every matching row.
app.get("/api/bids/export.csv", (req, res) => {
  const bidders = getBidders();
  let bids = getBids().map((b) => bidWithBidder(b, bidders));
  const { q, status, risk, category } = req.query;

  if (q) {
    const query = String(q).toLowerCase();
    bids = bids.filter(
      (b) => b.bid_id.toLowerCase().includes(query) || b.bidder_name.toLowerCase().includes(query)
    );
  }
  if (status) bids = bids.filter((b) => b.verification_status === status);
  if (risk) bids = bids.filter((b) => b.risk_category === risk);
  if (category) bids = bids.filter((b) => b.category === category);

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
  const csv = toCsv(rows);
  res.set("Content-Type", "text/csv");
  res.set("Content-Disposition", `attachment; filename="procureshield-bids-${Date.now()}.csv"`);
  res.send(csv);
});

app.get("/api/bids/:id", (req, res) => {
  const bidders = getBidders();
  const bidId = decodeURIComponent(req.params.id);
  const bid = getBids().find((b) => b.bid_id === bidId);
  if (!bid) return res.status(404).json({ message: "Bid not found" });

  const bidder = bidders.find((b) => b.bidder_id === bid.bidder_id);
  const { edges } = buildRelationshipGraph(bidders);
  const bidderEdges = edges.filter((e) => e.source === bidder.bidder_id || e.target === bidder.bidder_id);
  const evidenceForBidder = Array.from(new Set(bidderEdges.flatMap((e) => e.evidence)));

  const checklist = buildChecklist({ bidder, bid, evidenceForBidder });

  res.json({
    bid: bidWithBidder(bid, bidders),
    bidder: maskBidder(bidder),
    checklist,
    relatedEdges: bidderEdges.map((e) => {
      const otherId = e.source === bidder.bidder_id ? e.target : e.source;
      const other = bidders.find((x) => x.bidder_id === otherId);
      return {
        bidder_id: otherId,
        company_name: other ? other.company_name : otherId,
        score: e.score,
        evidence: e.evidence,
        linkable: e.linkable,
      };
    }),
  });
});

// ---------------------------------------------------------------------
// Bidders
// ---------------------------------------------------------------------
app.get("/api/bidders", (req, res) => {
  const bidders = getBidders().map(maskBidder);
  res.json({ count: bidders.length, bidders });
});

app.get("/api/bidders/:id", (req, res) => {
  const bidders = getBidders();
  const bidder = bidders.find((b) => b.bidder_id === req.params.id);
  if (!bidder) return res.status(404).json({ message: "Bidder not found" });
  const bids = getBids().filter((b) => b.bidder_id === bidder.bidder_id);
  res.json({ bidder: maskBidder(bidder), bids });
});

// ---------------------------------------------------------------------
// Network / relationship graph
// ---------------------------------------------------------------------
app.get("/api/network", (req, res) => {
  const bidders = getBidders();
  const { edges, clusters } = buildRelationshipGraph(bidders);
  res.json({
    nodes: bidders.map(maskBidder),
    edges: edges.filter((e) => e.linkable),
    clusters,
    weights: WEIGHTS,
  });
});

app.get("/api/network/:bidderId", (req, res) => {
  const bidders = getBidders();
  const { edges, clusters } = buildRelationshipGraph(bidders);
  const bidderId = req.params.bidderId;
  const target = bidders.find((b) => b.bidder_id === bidderId);
  if (!target) return res.status(404).json({ message: "Bidder not found" });

  const relatedEdges = edges.filter((e) => e.source === bidderId || e.target === bidderId);
  const relatedIds = new Set([bidderId]);
  relatedEdges.forEach((e) => {
    relatedIds.add(e.source);
    relatedIds.add(e.target);
  });
  const nodes = bidders.filter((b) => relatedIds.has(b.bidder_id)).map(maskBidder);
  const cluster = clusters.find((c) => c.members.includes(bidderId)) || null;

  res.json({ nodes, edges: relatedEdges, cluster });
});

app.get("/api/network/cluster/:clusterId", (req, res) => {
  const bidders = getBidders();
  const { clusters } = buildRelationshipGraph(bidders);
  const cluster = clusters.find((c) => c.cluster_id === req.params.clusterId);
  if (!cluster) return res.status(404).json({ message: "Cluster not found" });
  const members = bidders.filter((b) => cluster.members.includes(b.bidder_id)).map(maskBidder);
  res.json({ cluster, members });
});

// ---------------------------------------------------------------------
// Alerts (derived from clusters + high risk bids - deterministic, not stored)
// ---------------------------------------------------------------------
app.get("/api/alerts", (req, res) => {
  const bidders = getBidders();
  const bids = getBids();
  const { clusters } = buildRelationshipGraph(bidders);

  const alerts = [];
  clusters.forEach((c) => {
    const memberNames = c.members.map((m) => bidders.find((b) => b.bidder_id === m)?.company_name).join(", ");
    const severity = c.risk_category === "Critical" ? "red" : c.risk_category === "High" ? "orange" : "yellow";
    if (c.evidence.includes("sharedDirector")) {
      alerts.push({
        id: `AL-${c.cluster_id}-DIR`,
        severity: c.risk_category === "Critical" ? "red" : "red",
        title: "High-risk bidder relationship detected",
        description: `Shared director signal detected among: ${memberNames}.`,
        cluster_id: c.cluster_id,
        date: "2026-09-16",
        bid_id: null,
      });
    }
    if (c.evidence.includes("sharedAddress")) {
      alerts.push({
        id: `AL-${c.cluster_id}-ADDR`,
        severity: "orange",
        title: "Multiple bidders share a registered address",
        description: `Address similarity detected among: ${memberNames}.`,
        cluster_id: c.cluster_id,
        date: "2026-09-15",
        bid_id: null,
      });
    }
    if (c.evidence.includes("sharedBank")) {
      alerts.push({
        id: `AL-${c.cluster_id}-BANK`,
        severity: "orange",
        title: "Shared bank account relationship detected",
        description: `Bank account match detected among: ${memberNames}.`,
        cluster_id: c.cluster_id,
        date: "2026-09-14",
        bid_id: null,
      });
    }
  });

  bids
    .filter((b) => b.risk_score >= 61)
    .slice(0, 6)
    .forEach((b) => {
      alerts.push({
        id: `AL-${b.bid_id}`,
        severity: "yellow",
        title: "Document inconsistency found",
        description: `Bid ${b.bid_id} flagged for elevated relationship risk (${b.risk_score}/100).`,
        cluster_id: null,
        date: b.submission_date,
        bid_id: b.bid_id,
      });
    });

  res.json({ count: alerts.length, alerts });
});

// ---------------------------------------------------------------------
// Verification workflow (human-in-the-loop) - mutates bids.json + audit log
// ---------------------------------------------------------------------
function applyVerificationAction(bidId, newStatus, action, comment, res) {
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
  res.json({ success: true, bid: bidWithBidder(bids[idx], getBidders()), auditEntry: entry, auditLogCount: log.length });
}

app.post("/api/verification/:bidId/review", (req, res) => {
  applyVerificationAction(req.params.bidId, "Needs Review", "Sent for Manual Review", req.body?.comment, res);
});
app.post("/api/verification/:bidId/false-positive", (req, res) => {
  applyVerificationAction(req.params.bidId, "Verified", "Marked as False Positive", req.body?.comment, res);
});
app.post("/api/verification/:bidId/escalate", (req, res) => {
  applyVerificationAction(req.params.bidId, "Needs Review", "Escalated", req.body?.comment, res);
});
app.post("/api/verification/:bidId/confirm", (req, res) => {
  applyVerificationAction(req.params.bidId, "Verified", "Confirmed & Closed", req.body?.comment, res);
});

// ---------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------
app.get("/api/audit-log", (req, res) => {
  res.json({ log: getAuditLog() });
});

// ---------------------------------------------------------------------
// AI abstraction endpoint
// ---------------------------------------------------------------------
app.post("/api/ai/analyze", async (req, res) => {
  const { mode, payload } = req.body || {};
  try {
    let result;
    if (mode === "relationship") {
      result = await analyzeRelationship(payload);
    } else if (mode === "checklist") {
      result = await explainChecklistItem(payload);
    } else if (mode === "investigation_summary") {
      result = await summarizeInvestigation(payload);
    } else {
      return res.status(400).json({ message: "Unknown AI mode" });
    }
    res.json({ ...result, disclaimer: DISCLAIMER });
  } catch (e) {
    res.status(500).json({ message: "AI analysis failed", error: e.message });
  }
});

// ---------------------------------------------------------------------
// Reports (data used by client-side PDF generation)
// ---------------------------------------------------------------------
app.get("/api/reports/:type", (req, res) => {
  const bidders = getBidders();
  const bids = getBids().map((b) => bidWithBidder(b, bidders));
  const { clusters } = buildRelationshipGraph(bidders);
  const auditLog = getAuditLog();
  const type = req.params.type;

  const generatedAt = new Date().toISOString();

  if (type === "bid-verification") {
    return res.json({
      type,
      title: "Bid Verification Report",
      generatedAt,
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
      type,
      title: "Bidder Network Report",
      generatedAt,
      clusters: clusters.map((c) => ({
        cluster_id: c.cluster_id,
        members: c.members.map((m) => bidders.find((b) => b.bidder_id === m)?.company_name),
        risk_score: c.risk_score,
        risk_category: c.risk_category,
        evidence: c.evidence,
      })),
    });
  }
  if (type === "risk-analysis") {
    return res.json({
      type,
      title: "Risk Analysis Report",
      generatedAt,
      distribution: {
        low: bids.filter((b) => b.risk_score <= 30).length,
        medium: bids.filter((b) => b.risk_score > 30 && b.risk_score <= 60).length,
        high: bids.filter((b) => b.risk_score > 60 && b.risk_score <= 80).length,
        critical: bids.filter((b) => b.risk_score > 80).length,
      },
      topRiskBids: bids
        .slice()
        .sort((a, b) => b.risk_score - a.risk_score)
        .slice(0, 10)
        .map((b) => ({ bid_id: b.bid_id, bidder: b.bidder_name, risk_score: b.risk_score })),
    });
  }
  if (type === "investigation-summary") {
    return res.json({
      type,
      title: "Investigation Summary",
      generatedAt,
      clusters: clusters.map((c) => ({
        cluster_id: c.cluster_id,
        members: c.members.map((m) => bidders.find((b) => b.bidder_id === m)?.company_name),
        risk_score: c.risk_score,
        evidence: c.evidence,
      })),
      recentAuditActions: auditLog.slice(0, 15),
    });
  }
  res.status(400).json({ message: "Unknown report type" });
});

// CSV export for the two reports that are naturally tabular. The other two
// (bidder-network / investigation-summary) are cluster-shaped, not row-shaped,
// so they stay JSON/PDF-only.
app.get("/api/reports/:type/csv", (req, res) => {
  const bidders = getBidders();
  const bids = getBids().map((b) => bidWithBidder(b, bidders));
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
      .map((b) => ({ bid_id: b.bid_id, bidder: b.bidder_name, risk_score: b.risk_score, risk_category: b.risk_category }));
    columns = ["bid_id", "bidder", "risk_score", "risk_category"];
  } else {
    return res.status(400).json({ message: "CSV export is only available for bid-verification and risk-analysis reports." });
  }

  const csv = toCsv(rows, columns);
  res.set("Content-Type", "text/csv");
  res.set("Content-Disposition", `attachment; filename="procureshield-${type}-${Date.now()}.csv"`);
  res.send(csv);
});

// ---------------------------------------------------------------------
app.get("/api/health", (req, res) => res.json({ status: "ok", demo: true }));

// 404 for any unmatched /api route
app.use("/api", (req, res) => {
  res.status(404).json({ message: `No route for ${req.method} ${req.originalUrl}` });
});

// Centralized error handler - catches thrown/rejected errors from any route
// above (e.g. malformed JSON body, unexpected file I/O errors) so the API
// always returns a clean JSON error instead of leaking a stack trace or
// hanging the request.
app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);
  res.status(err.status || 500).json({ message: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`ProcureShield AI server (SANDBOX/DEMO DATA) running on http://localhost:${PORT}`);
});
