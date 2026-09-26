// engineClient.js
// The only place this server talks to the ProcureShield Engine (the Python
// FastAPI service in ../engine). Everything the UI shows as a risk score,
// signal, relationship or explanation originates here.
//
// Design notes:
//  * One analysis is cached per dataset fingerprint. The demo data only
//    changes when a verification action rewrites bids.json, and verification
//    status is not an engine input, so the cache is safe and keeps the UI fast.
//  * Engine failures are surfaced as EngineUnavailableError with the URL in
//    the message, so the UI can tell an officer exactly what is not running
//    instead of silently showing zeros.

import crypto from "crypto";
import {
  buildBidderRiskMap,
  buildClusters,
  buildEdges,
  buildEngineRecords,
} from "./engineMapping.js";
import { registryEdges } from "./registrySignals.js";

// 127.0.0.1 rather than localhost: Node 18+ resolves localhost to ::1 first,
// and uvicorn binds IPv4 by default, which otherwise fails as "fetch failed".
const ENGINE_URL = (process.env.ENGINE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const ENGINE_TIMEOUT_MS = Number(process.env.ENGINE_TIMEOUT_MS || 15_000);
const ENGINE_TRAIN = String(process.env.ENGINE_TRAIN || "false").toLowerCase() === "true";
// Render's lightweight Python service may not have PyTorch/PyG available.
// Keep production analysis deterministic unless model support is explicitly enabled.
const ENGINE_USE_MODEL = String(process.env.ENGINE_USE_MODEL || "false").toLowerCase() === "true";

export class EngineUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "EngineUnavailableError";
    this.status = 503;
  }
}

async function engineFetch(path, options = {}) {
  const requestTimeout = path === "/health" ? Math.min(ENGINE_TIMEOUT_MS, 4_000) : path.includes("/intelligence/") ? Math.min(ENGINE_TIMEOUT_MS, 8_000) : ENGINE_TIMEOUT_MS;
  // Render free services can briefly return 502/503/504 while the Python
  // service is waking up. Retry those transient gateway failures before
  // surfacing an engine outage to the bidder/officer UI.
  const retryDelays = [700];
  let lastGatewayError = null;

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeout);
    try {
      const res = await fetch(`${ENGINE_URL}${path}`, {
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        ...options,
      });
      const body = await res.json().catch(() => ({}));

      if (res.ok) return body;

      const detail = body.detail || body.message || `HTTP ${res.status}`;
      if ([502, 503, 504].includes(res.status) && attempt < retryDelays.length) {
        lastGatewayError = new EngineUnavailableError(
          `ProcureShield engine rejected ${path}: ${detail}`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
        continue;
      }

      throw new EngineUnavailableError(
        `ProcureShield engine rejected ${path}: ${detail}`
      );
    } catch (err) {
      if (err instanceof EngineUnavailableError) throw err;
      const reason = err.name === "AbortError"
        ? `timed out after ${ENGINE_TIMEOUT_MS}ms`
        : err.message;
      throw new EngineUnavailableError(
        `Cannot reach the ProcureShield engine at ${ENGINE_URL} (${reason}). ` +
          `Start it with: cd engine && uvicorn backend.main:app --port 8000`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastGatewayError || new EngineUnavailableError(
    `ProcureShield engine is temporarily unavailable at ${ENGINE_URL}.`
  );
}
// ---------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------
let cache = null; // { fingerprint, analysis, view, at, records }
let analysisPromise = null;

function fingerprint(records) {
  return crypto.createHash("sha1").update(JSON.stringify(records)).digest("hex");
}

export function invalidateCache() {
  cache = null;
}

export function engineUrl() {
  return ENGINE_URL;
}

/**
 * Reshape one raw /analyze response into everything the Express routes need.
 */
function buildView(analysis, bidders) {
  const bidderIds = bidders.map((b) => b.bidder_id);

  // all_entities covers the full portfolio (every scored company, including
  // low-risk ones); suspicious_entities is the flagged subset of the same
  // records, so it is only a fallback if the engine predates that field.
  const entities = {};
  const source = analysis.all_entities?.length
    ? analysis.all_entities
    : analysis.suspicious_entities || [];
  source.forEach((e) => {
    entities[e.entity_id] = e;
  });
  const riskMap = buildBidderRiskMap({ entities }, bidderIds);

  // engine entity id -> raw bidder id (aliases resolve merged registrations)
  const entityToRaw = new Map();
  Object.entries(riskMap).forEach(([raw, info]) => {
    if (info.entity_id) entityToRaw.set(info.entity_id, raw);
  });

  const regEdges = registryEdges(bidders);
  const edges = buildEdges(analysis.suspicious_relationships || [], entityToRaw, regEdges);
  const clusters = buildClusters(edges, bidderIds, riskMap);

  return {
    riskMap,
    edges,
    clusters,
    registryEdges: regEdges,
    headline: {
      risk_score: analysis.risk_score,
      risk_level: analysis.risk_level,
      mode: analysis.mode,
      model_probability: analysis.model_probability,
      explanation: analysis.explanation,
      analysis_id: analysis.analysis_id,
    },
    graph: {
      nodes: analysis.graph_nodes || [],
      edges: analysis.graph_edges || [],
      stats: analysis.graph_stats || {},
    },
    flagged: (analysis.suspicious_entities || []).length,
    signalRollup: analysis.risk_signals || [],
    training: analysis.training || null,
    validation: analysis.validation || null,
    disclaimer: analysis.disclaimer,
  };
}

/**
 * Run (or reuse) an analysis of the current dataset.
 * @param {Array} bidders bidders.json
 * @param {Array} bids    bids.json
 * @param {{force?: boolean, train?: boolean}} opts
 */
export async function analyze(bidders, bids, opts = {}) {
  const records = buildEngineRecords(bidders, bids);
  if (records.length === 0) {
    throw new EngineUnavailableError("No bid records could be mapped for analysis.");
  }
  const fp = fingerprint(records);

  if (!opts.force && cache && cache.fingerprint === fp) return cache.view;

  if (analysisPromise) return analysisPromise;

  analysisPromise = (async () => {
    const analysis = await engineFetch("/analyze", {
      method: "POST",
      body: JSON.stringify({
        records,
        train: opts.train ?? ENGINE_TRAIN,
        use_model: opts.useModel ?? ENGINE_USE_MODEL,
        max_entities: 500,
        include_all_entities: true,
      }),
    });

    const view = buildView(analysis, bidders);
    cache = { fingerprint: fp, analysis, view, at: new Date().toISOString(), records };
    return view;
  })();

  try {
    return await analysisPromise;
  } finally {
    analysisPromise = null;
  }
}

/**
 * The engine keeps the analysed graph in memory, so a restart wipes the
 * context its entity endpoints depend on while this server still holds a
 * cached view. Re-post the last records once and retry rather than surfacing
 * a spurious "no analysis has been run" error to the officer.
 */
async function withEngineContext(fn) {
  try {
    return await fn();
  } catch (err) {
    const lost = /no analysis has been run/i.test(err.message || "");
    if (!lost || !cache?.records) throw err;
    await engineFetch("/analyze", {
      method: "POST",
      body: JSON.stringify({
        records: cache.records,
        train: false,
        use_model: ENGINE_USE_MODEL,
        max_entities: 500,
        include_all_entities: true,
      }),
    });
    return fn();
  }
}

// GeM ids contain slashes ("GEM/2026/T/002001"), which cannot survive a path
// segment even URL-encoded, so both lookups use the engine's query-parameter
// form rather than /company/{id} and /tender/{id}.
/** Engine-side detail for one company (full signal list, features, history). */
export async function companyDetail(bidderId) {
  return withEngineContext(() =>
    engineFetch(`/lookup/company?company_id=${encodeURIComponent(bidderId)}`)
  );
}

/** Engine-side detail for one tender (bidders, spread, tender signals). */
export async function tenderDetail(tenderId) {
  return withEngineContext(() =>
    engineFetch(`/lookup/tender?tender_id=${encodeURIComponent(tenderId)}`)
  );
}

/** Ego network around a company, straight from the engine's graph. */
export async function egoNetwork(bidderId, depth = 1) {
  return withEngineContext(() =>
    engineFetch(`/network/${encodeURIComponent(bidderId)}?depth=${depth}`)
  );
}

/** Train the GAT on the graph from the last analysis. Labels required. */
export async function train(body = { reuse_last_analysis: true }) {
  return withEngineContext(() =>
    engineFetch("/train", { method: "POST", body: JSON.stringify(body) })
  );
}

/** Engine liveness + model state. Never throws: returns {reachable:false,...}. */
export async function status() {
  try {
    const health = await engineFetch("/health");
    return {
      reachable: true,
      url: ENGINE_URL,
      ...health,
      cached_analysis_at: cache?.at || null,
    };
  } catch (err) {
    return { reachable: false, url: ENGINE_URL, message: err.message, cached_analysis_at: cache?.at || null };
  }
}

export async function intelligencePdf(payload) {
  return engineFetch("/intelligence/pdf", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function intelligenceValidateDocument(payload) {
  return engineFetch("/intelligence/validate-document", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function intelligenceRequirements(payload) {
  return engineFetch("/intelligence/requirements", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function intelligenceEligibility(payload) {
  return engineFetch("/intelligence/eligibility", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}