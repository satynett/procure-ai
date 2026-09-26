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
import { buildChecklist, buildTenderComparison } from "./utils/checklist.js";
import { toCsv } from "./utils/csv.js";
import { requireAuth, DEMO_TOKEN } from "./middleware/auth.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { initDatabase, getCollection, replaceCollection, createBidSubmission } from "./db/store.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

const app = express();
app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(requireAuth);

const VALID_VERIFICATION_STATUSES = ["Verified", "Needs Review", "Rejected"];
const MAX_COMMENT_LENGTH = 1000;

function hasValidDocumentSignature(filename, contentBase64) {
  try {
    const raw = Buffer.from(contentBase64, "base64");
    if (!raw.length) return false;
    const ext = filename.toLowerCase().split(".").pop();
    if (ext === "pdf") return raw.subarray(0, 5).toString("ascii") === "%PDF-";
    if (ext === "docx") return raw.subarray(0, 2).toString("ascii") === "PK";
    if (ext === "doc") return raw.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1";
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// PostgreSQL-backed data access.
// The route layer keeps the existing array-shaped API contract so the
// React UI and Python risk engine do not need to change during migration.
// ---------------------------------------------------------------------
const COLLECTION_BY_FILE = {
  "bidders.json": "bidders",
  "bids.json": "bids",
  "tenders.json": "tenders",
  "auditLog.json": "auditLog",
};

function readJson(file) {
  const collection = COLLECTION_BY_FILE[file];
  return collection ? getCollection(collection) : [];
}
async function writeJson(file, data) {
  const collection = COLLECTION_BY_FILE[file];
  if (!collection) throw new Error("Unknown data collection: " + file);
  await replaceCollection(collection, data);
}
function getBidders() { return readJson("bidders.json"); }
function getBids() { return readJson("bids.json"); }
function getTenders() { return readJson("tenders.json"); }

function decorateTender(tender, bids, bidders) {
  const tenderBids = bids.filter((b) => b.tender_id === tender.tender_id);
  const winnerBid = tender.status === "Awarded" && tenderBids.length
    ? (tender.winner_bid_id ? tenderBids.find((b) => b.bid_id === tender.winner_bid_id) || null
      : tenderBids.slice().sort((a, b) => Number(a.bid_amount || Infinity) - Number(b.bid_amount || Infinity))[0])
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
  return readJson("auditLog.json");
}
async function appendAuditLog(entry) {
  const log = getAuditLog();
  log.unshift(entry);
  await writeJson("auditLog.json", log);
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
function degradedAnalysis(bidders) {
  const riskMap = Object.fromEntries(bidders.map((b) => [b.bidder_id, {
    entity_id: b.bidder_id,
    score: 0,
    category: "Low",
    cluster_id: null,
    signals: [],
    explanation: "Analytics engine temporarily unavailable. No risk conclusion is being produced.",
    recommended_actions: [],
  }]));

  // Keep the relationship/network pages useful during an engine outage.
  // These are exact registry matches only (phone/bank), not risk scores.
  const registryEdges = registryEvidenceFor
    ? registryEdgesForFallback(bidders)
    : [];
  const edges = registryEdges.map((e) => ({
    ...e,
    score: 0,
    linkable: true,
    engine_score: 0,
  }));
  const clusters = buildClusters(edges, bidders.map((b) => b.bidder_id), riskMap);

  return {
    riskMap,
    edges,
    clusters,
    registryEdges,
    headline: {
      risk_score: null,
      risk_level: "Unavailable",
      mode: "engine-unavailable",
      model_probability: null,
      explanation: "The analytics engine is temporarily unavailable. Review data is still accessible.",
      analysis_id: null,
    },
    graph: { nodes: [], edges: [], stats: {} },
    flagged: 0,
    signalRollup: [],
    training: null,
    validation: null,
    disclaimer: "ProcureShield produces statistical risk indicators only. When the analytics engine is unavailable, no risk conclusion is produced.",
  };
}

function registryEdgesForFallback(bidders) {
  const byValue = (field) => {
    const groups = new Map();
    for (const bidder of bidders) {
      const value = String(bidder?.[field] || "").trim();
      if (!value) continue;
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(bidder.bidder_id);
    }
    return groups;
  };
  const edges = new Map();
  const add = (a, b, evidence, reason) => {
    const [source, target] = [a, b].sort();
    const key = `${source}::${target}`;
    if (!edges.has(key)) edges.set(key, { source, target, evidence: [], reasons: [] });
    const edge = edges.get(key);
    if (!edge.evidence.includes(evidence)) edge.evidence.push(evidence);
    edge.reasons.push(reason);
  };
  for (const [field, evidence, reason] of [
    ["phone", "sharedPhone", "registered against the same contact phone number"],
    ["bank_account", "sharedBank", "registered against the same bank account number"],
  ]) {
    for (const ids of byValue(field).values()) {
      if (ids.length < 2) continue;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) add(ids[i], ids[j], evidence, reason);
      }
    }
  }
  return Array.from(edges.values());
}

async function getAnalysis(opts = {}) {
  const bidders = getBidders();
  try {
    return await analyze(bidders, getBids(), opts);
  } catch (err) {
    if (err instanceof EngineUnavailableError) {
      console.warn("Analytics engine unavailable; serving degraded officer data:", err.message);
      return degradedAnalysis(bidders);
    }
    throw err;
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

/** Decorate a stored bid with its bidder and the engine's risk score. */
function decorateBid(bid, bidders, view) {
  const bidder = bidders.find((b) => b.bidder_id === bid.bidder_id);
  const risk = view.riskMap[bid.bidder_id] || { score: 0, category: "Low" };
  const { submitted_document_files, ...publicBid } = bid;
  return {
    ...publicBid,
    bidder_name: bid.bidder_company_name || (bidder ? bidder.company_name : "Unknown"),
    msme_status: bidder ? bidder.msme_status : "Unknown",
    // The engine scores companies, not individual bids: a bid inherits the
    // risk of the bidder that submitted it. Any stored `risk_score` in
    // bids.json is overwritten so there is a single source of truth.
    risk_score: risk.score,
    risk_category: risk.category,
    cluster_id: risk.cluster_id || null,
    uploaded_file_count: Array.isArray(bid.submitted_document_files) ? bid.submitted_document_files.length : 0,
    has_uploaded_pdf: Array.isArray(bid.submitted_document_files) && bid.submitted_document_files.some((f) => String(f?.content_type || "").toLowerCase() === "application/pdf"),
    first_pdf_name: Array.isArray(bid.submitted_document_files) ? bid.submitted_document_files.find((f) => String(f?.content_type || "").toLowerCase() === "application/pdf")?.name || null : null,
    first_pdf_index: Array.isArray(bid.submitted_document_files) ? bid.submitted_document_files.findIndex((f) => String(f?.content_type || "").toLowerCase() === "application/pdf") : -1,
  };
}

// ---------------------------------------------------------------------
// Auth (demo only - NOT production authentication)
// ---------------------------------------------------------------------
app.post("/api/auth/login", rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  const { username, password } = req.body || {};
  const expectedUser = process.env.DEMO_USERNAME || "admin";
  const expectedPass = process.env.DEMO_PASSWORD || "admin123";
  const bidderUser = process.env.DEMO_BIDDER_USERNAME || "bidder";
  const bidderPass = process.env.DEMO_BIDDER_PASSWORD || "bidder123";
  if (username === expectedUser && password === expectedPass) {
    return res.json({ success: true, token: DEMO_TOKEN, officer: { name: "Procurement Officer 01", role: "Procurement Officer", org: "GeM Demo Cell" } });
  }
  if (username === bidderUser && password === bidderPass) {
    const demoBidderId = process.env.DEMO_BIDDER_ID || getBidders()[0]?.bidder_id || "BID-2001";
    return res.json({
      success: true,
      token: DEMO_TOKEN,
      officer: { name: "Demo Bidder", role: "Bidder", org: "GeM Supplier Demo", bidder_id: demoBidderId },
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
function tenderManagementPayload(tender, bids, bidders, view = null) {
  const tenderBids = bids.filter((b) => b.tender_id === tender.tender_id).map((bid) => {
    const bidder = bidders.find((x) => x.bidder_id === bid.bidder_id);
    const risk = view?.riskMap?.[bid.bidder_id] || {};
    const decorated = decorateBid(bid, bidders, view || { riskMap: {} });
    return {
      ...decorated,
      bidder_email: bidder?.email || "—", bidder_phone: bidder?.phone || "—",
      gst_number: bidder?.gst_number || "—", pan_number: bidder?.pan_number || "—",
      udyam_status: bidder?.msme_status || "—", bidder_address: bidder?.address || "—",
      quoted_amount: Number(bid.bid_amount || 0),
      government_estimated_value: Number(tender.estimated_value || 0),
      award_amount: tender.winner_bid_id === bid.bid_id ? (tender.award_amount || bid.bid_amount) : null,
      finalComparison: buildTenderComparison({ tender, bidder, bid }),
    };
  });
  // Transparent prototype ranking: compliance 50%, price competitiveness 30%,
  // and relationship-risk review signal 20%. This is decision support only;
  // the authorised officer remains responsible for the final award.
  const rankedBids = tenderBids
    .map((bid) => {
      const complianceScore = Number(bid.finalComparison?.score || 0);
      const quote = Number(bid.quoted_amount || 0);
      const comparableQuotes = tenderBids
        .filter((x) => Number(x.quoted_amount || 0) > 0)
        .map((x) => Number(x.quoted_amount));
      const lowestQuote = comparableQuotes.length ? Math.min(...comparableQuotes) : 0;
      const priceScore = quote > 0 && lowestQuote > 0 ? Math.min(100, (lowestQuote / quote) * 100) : 0;
      const riskScore = Number(bid.risk_score || 0);
      const riskReviewScore = Math.max(0, 100 - riskScore);
      const evaluationScore = Math.round((complianceScore * 0.5) + (priceScore * 0.3) + (riskReviewScore * 0.2));
      return { ...bid, evaluation_score: evaluationScore, ranking_components: {
        compliance: Math.round(complianceScore),
        price_competitiveness: Math.round(priceScore),
        risk_review: Math.round(riskReviewScore),
      }};
    })
    .sort((a,b) => b.evaluation_score - a.evaluation_score || a.quoted_amount - b.quoted_amount)
    .map((bid, index) => ({ ...bid, rank: index + 1 }));

  return {
    tender: { ...decorateTender(tender,bids,bidders), lifecycle:tender.status, award_amount:tender.award_amount||null,
      winner_bid_id:tender.winner_bid_id||null, rfp_text:tender.rfp_text||"", rfp_content_base64:tender.rfp_content_base64||null,
      eligibility_requirements:tender.eligibility_requirements||[], technical_requirements:tender.technical_requirements||[], important_dates:tender.important_dates||[] },
    bids:rankedBids,
    ranking:{
      method:"Prototype decision-support score",
      weights:{compliance:50,price_competitiveness:30,risk_review:20},
      note:"Ranking supports officer review; it does not automatically determine the award."
    },
    stats:{
      total_bids:tenderBids.length, verified:tenderBids.filter(b=>b.verification_status==="Verified").length,
      needs_review:tenderBids.filter(b=>b.verification_status==="Needs Review").length, rejected:tenderBids.filter(b=>b.verification_status==="Rejected").length,
      lowest_quote:tenderBids.length?Math.min(...tenderBids.map(b=>b.quoted_amount||Infinity)):null,
      highest_quote:tenderBids.length?Math.max(...tenderBids.map(b=>b.quoted_amount||0)):null
    }
  };
}

app.get("/api/officer/tenders/:id", asyncRoute(async (req,res)=>{
  const tenderId=decodeURIComponent(req.params.id); const tender=getTenders().find(t=>t.tender_id===tenderId);
  if(!tender) return res.status(404).json({message:"Tender not found"});
  const bidders=getBidders(); const bids=getBids(); let view=null;
  try { view=await getAnalysis(); } catch { view={riskMap:{}}; }
  res.json(tenderManagementPayload(tender,bids,bidders,view));
}));

app.post("/api/officer/tenders", asyncRoute(async (req,res)=>{
  const {title,department,category,deadline,estimated_value,publish=false,rfp_filename,rfp_content_base64,rfp_documents=[]}=req.body||{};
  if(!title||!department||!deadline||(!rfp_content_base64 && !rfp_documents.length)) {
    return res.status(400).json({message:"Title, department, deadline and at least one RFP document are required."});
  }

  const suppliedDocs = rfp_documents.length
    ? rfp_documents
    : [{filename:rfp_filename||"tender-rfp.pdf",content_type:"application/pdf",content_base64:rfp_content_base64}];

  const analyses=[];
  for(const doc of suppliedDocs){
    const analysis=await intelligencePdf({
      filename:doc.filename||"tender-rfp.pdf",
      content_base64:doc.content_base64,
      content_type:doc.content_type||"application/pdf"
    });
    if(analysis.extraction_status==="wrong_document" || analysis.extraction_status==="empty" || analysis.extraction_status==="error" || analysis.extraction_status==="unsupported_type"){
      return res.status(400).json({
        message:analysis.message || `Wrong document: ${doc.filename || "uploaded file"}`,
        filename:doc.filename || null,
        document_error:true
      });
    }
    analyses.push(analysis);
  }

  const combinedText=analyses.map(x=>x.text||"").filter(Boolean).join("\n\n");
  const combinedRequirements=analyses.reduce((acc,analysis)=>{
    const parsed=analysis.requirements||{};
    acc.eligibility_requirements.push(...(parsed.eligibility_requirements||[]));
    acc.technical_requirements.push(...(parsed.technical_requirements||[]));
    acc.required_documents.push(...(parsed.required_documents||[]));
    acc.important_dates.push(...(parsed.important_dates||[]));
    return acc;
  },{eligibility_requirements:[],technical_requirements:[],required_documents:[],important_dates:[]});
  combinedRequirements.required_documents=[...new Set(combinedRequirements.required_documents)];
  combinedRequirements.important_dates=[...new Set(combinedRequirements.important_dates)];
  const summary=[...combinedRequirements.eligibility_requirements,...combinedRequirements.technical_requirements].map(x=>x.requirement).filter(Boolean).slice(0,8).join(", ")||"Officer review required before publication.";

  const tenders=getTenders(); const year=new Date().getFullYear(); const sequence=String(tenders.length+1).padStart(4,"0");
  const primary=suppliedDocs[0];
  const tender={
    tender_id:`GEM/${year}/T/${sequence}`,
    title:String(title).trim(),
    department:String(department).trim(),
    category:String(category||"General Procurement").trim(),
    status:publish?"Open":"Draft",
    deadline:String(deadline),
    estimated_value:Number(estimated_value||0),
    rfp_filename:primary.filename||rfp_filename||"tender-rfp.pdf",
    rfp_content_base64:primary.content_base64,
    rfp_documents:suppliedDocs.map(d=>({filename:d.filename,content_type:d.content_type||"application/pdf",content_base64:d.content_base64})),
    rfp_text:combinedText,
    eligibility_summary:summary,
    eligibility_requirements:combinedRequirements.eligibility_requirements,
    technical_requirements:combinedRequirements.technical_requirements,
    required_documents:combinedRequirements.required_documents,
    important_dates:combinedRequirements.important_dates,
    parser:"deterministic-prototype",
    created_at:new Date().toISOString(),
    published_at:publish?new Date().toISOString():null
  };
  tenders.unshift(tender); await writeJson("tenders.json",tenders);
  await appendAuditLog({id:`AUD-${Date.now()}`,officer:"Procurement Officer 01",action:publish?"Tender Published":"Tender Created as Draft",tender_id:tender.tender_id,timestamp:new Date().toISOString(),rfp_filename:tender.rfp_filename,rfp_document_count:suppliedDocs.length});
  res.status(201).json({tender:decorateTender(tender,getBids(),getBidders())});
}));

app.patch("/api/officer/tenders/:id",async (req,res)=>{
  const tenderId=decodeURIComponent(req.params.id); const tenders=getTenders(); const idx=tenders.findIndex(t=>t.tender_id===tenderId);
  if(idx===-1) return res.status(404).json({message:"Tender not found"}); const tender={...tenders[idx]}; const action=req.body?.action;
  if(!["publish","close","withdraw","award"].includes(action)) return res.status(400).json({message:"Unknown tender action."});
  if(action==="publish"){if(!tender.rfp_content_base64)return res.status(400).json({message:"An RFP must be uploaded before publishing."});tender.status="Open";tender.published_at=new Date().toISOString();}
  if(action==="close"){tender.status="Closed";tender.closing_date=new Date().toISOString().slice(0,10);}
  if(action==="withdraw"){if(["Awarded","Closed"].includes(tender.status))return res.status(400).json({message:"Closed or awarded tenders cannot be withdrawn."});tender.status="Withdrawn";}
  if(action==="award"){const bid=getBids().find(b=>b.bid_id===req.body?.bid_id&&b.tender_id===tenderId);if(!bid)return res.status(400).json({message:"Select a valid bid for this tender."});
    tender.status="Awarded";tender.closing_date=tender.closing_date||new Date().toISOString().slice(0,10);tender.award_date=new Date().toISOString().slice(0,10);tender.winner_bid_id=bid.bid_id;tender.award_amount=Number(req.body?.award_amount||bid.bid_amount||0);}
  tenders[idx]=tender;await writeJson("tenders.json",tenders);
  await appendAuditLog({id:`AUD-${Date.now()}`,officer:"Procurement Officer 01",action:`Tender ${action}`,tender_id:tenderId,bid_id:req.body?.bid_id||null,timestamp:new Date().toISOString(),award_amount:tender.award_amount||null});
  res.json({tender:decorateTender(tender,getBids(),getBidders())});
});

app.delete("/api/officer/tenders/:id",async (req,res)=>{
  const tenderId=decodeURIComponent(req.params.id);const tenders=getTenders();const idx=tenders.findIndex(t=>t.tender_id===tenderId);
  if(idx===-1)return res.status(404).json({message:"Tender not found"});if(!["Draft","Withdrawn"].includes(tenders[idx].status))return res.status(400).json({message:"Only draft or withdrawn tenders can be permanently removed. Use withdraw for an active tender."});
  tenders.splice(idx,1);await writeJson("tenders.json",tenders);await appendAuditLog({id:`AUD-${Date.now()}`,officer:"Procurement Officer 01",action:"Tender Permanently Removed",tender_id:tenderId,timestamp:new Date().toISOString()});
  res.json({success:true,removed:tenderId});
});


app.post("/api/bidder/bids", asyncRoute(async (req, res) => {
  const { tender_id, company_name, documents = [], bid_amount = null } = req.body || {};
  const tender = getTenders().find((t) => t.tender_id === tender_id);
  if (!tender || tender.status !== "Open") return res.status(400).json({ message: "This tender is not open for bidding." });
  if (!company_name?.trim()) return res.status(400).json({ message: "Company name is required." });

  const amount = Number(bid_amount);
  if (bid_amount === null || bid_amount === undefined || String(bid_amount).trim() === "" || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: "A valid bid amount greater than ₹0 is required." });
  }
  if (!Array.isArray(documents) || documents.length === 0) {
    return res.status(400).json({ message: "At least one bid document is required." });
  }

  // Submission should be fast and must not depend on a sleeping analytics engine.
  // The dedicated "Check My Documents" workflow performs the full AI/document
  // validation before bidding. At submission time we only verify the binary
  // signature, reject corrupt/garbage uploads, and store the bid as Needs Review.
  const validatedDocuments=[];
  for(const doc of documents){
    if(!doc || typeof doc !== "object"){
      return res.status(400).json({
        message:"Wrong document: each upload must be a real document file.",
        document_error:true
      });
    }
    const filename=String(doc.name || "bid-document").trim();
    const contentBase64=typeof doc.content_base64 === "string" ? doc.content_base64 : "";
    if(!/\.(pdf|doc|docx)$/i.test(filename)){
      return res.status(400).json({
        message:`Wrong document: ${filename} is not a supported document. Upload PDF, DOC or DOCX.`,
        filename,
        document_error:true
      });
    }
    if(!contentBase64 || !hasValidDocumentSignature(filename, contentBase64)){
      return res.status(400).json({
        message:`Wrong document: ${filename} is not a valid PDF, DOC or DOCX payload.`,
        filename,
        document_error:true
      });
    }
    validatedDocuments.push({
      name: filename,
      content_type: doc.content_type || "application/pdf",
      content_base64: contentBase64
    });
  }

  const cleanCompanyName = company_name.trim();
  const submittedFiles = validatedDocuments.filter(Boolean);
  const bidData = {
    tender_id,
    category: tender.category,
    bid_amount: amount,
    submission_date: new Date().toISOString().slice(0, 10),
    verification_status: "Needs Review",
    submitted_documents: submittedFiles.map((d) => d.name),
    submitted_document_files: submittedFiles,
  };

  // Persist bidder + bid atomically in PostgreSQL. This prevents duplicate
  // bidder primary keys when the browser retries or multiple submissions land
  // at nearly the same time.
  const { bidder, bid } = await createBidSubmission({
    companyName: cleanCompanyName,
    bidData,
  });

  // The next network/risk request will detect the changed dataset fingerprint
  // and automatically run the engine again.
  res.status(201).json({ success: true, bid, bidder_id: bidder.bidder_id });
}));

// ---------------------------------------------------------------------
// Bidder bid history
// ---------------------------------------------------------------------
app.get("/api/bidder/bids", asyncRoute(async (req, res) => {
  const bidderId = String(
    req.query.bidder_id ||
    process.env.DEMO_BIDDER_ID ||
    getBidders()[0]?.bidder_id ||
    "BID-2001"
  );
  const bidders = getBidders();
  let view = { riskMap: {} };
  try {
    view = await getAnalysis();
  } catch (err) {
    // Bidder history must remain usable even when analytics is temporarily unavailable.
    console.warn("Bidder history loaded without engine risk scores:", err.message);
  }
  const tenders = getTenders();
  const bids = getBids()
    .filter((b) => b.bidder_id === bidderId)
    .map((b) => {
      const tender = tenders.find((t) => t.tender_id === b.tender_id);
      return {
        ...decorateBid(b, bidders, view),
        tender_title: tender?.title || b.tender_id,
        tender_status: tender?.status || "Unknown",
        tender_deadline: tender?.deadline || tender?.closing_date || null,
        award_date: tender?.award_date || null,
        winner_name: tender?.status === "Awarded"
          ? decorateTender(tender, getBids(), bidders).winner_name
          : null,
      };
    })
    .sort((a, b) => String(b.submission_date || "").localeCompare(String(a.submission_date || "")));

  res.json({ count: bids.length, bids });
}));

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

app.get("/api/bids/:id/files/:index", asyncRoute(async (req, res) => {
  const bidId = decodeURIComponent(req.params.id);
  const index = Number(req.params.index);
  const bid = getBids().find((b) => b.bid_id === bidId);
  const files = Array.isArray(bid?.submitted_document_files) ? bid.submitted_document_files : [];
  const file = Number.isInteger(index) ? files[index] : null;
  if (!file?.content_base64) return res.status(404).json({ message: "Original uploaded file is not available." });
  const buffer = Buffer.from(file.content_base64, "base64");
  res.set("Content-Type", file.content_type || "application/octet-stream");
  res.set("Content-Disposition", `attachment; filename="${String(file.name || "bid-file").replace(/"/g, "")}"`);
  res.send(buffer);
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

  // The shared tender catalog is the compliance source of truth for both portals.
  const publishedTender = getTenders().find((t) => t.tender_id === bid.tender_id) || null;

  let tender = publishedTender;
  if (!tender) {
    try {
      tender = await tenderDetail(bid.tender_id);
    } catch (err) {
      console.warn("Tender lookup failed for " + bid.tender_id + ": " + err.message);
      tender = null;
    }
  }

  const finalComparison = buildTenderComparison({
    tender: publishedTender || tender,
    bidder,
    bid,
  });

  res.json({
    bid: {
      ...decorateBid(bid, bidders, view),
      submitted_document_files: Array.isArray(bid.submitted_document_files) ? bid.submitted_document_files : [],
    },
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
    finalComparison,
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
  await writeJson("bids.json", bids);

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
  const log = await appendAuditLog(entry);

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
const DB_SEED = String(process.env.DATABASE_SEED || "true").toLowerCase() !== "false";

export { app };

if (process.env.NODE_ENV !== "test") {
  await initDatabase({ seed: DB_SEED });
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`ProcureShield BFF (SANDBOX/DEMO DATA) on http://localhost:${PORT}`);
    console.log(`Analytics engine: ${engineUrl()}`);
  });
  // Match Render's edge keep-alive window to avoid intermittent 502 resets.
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 120_000;
}
