const API_ORIGIN = (import.meta.env.VITE_API_URL || (import.meta.env.PROD ? "https://procure-api.onrender.com" : "")).replace(/\/$/, "");
const BASE = `${API_ORIGIN}/api`;

// Short-lived GET cache + in-flight request deduplication.
// Officer pages repeatedly revisit the same analytics-backed endpoints;
// keeping them for 20s makes sidebar navigation instant after first load
// without turning the demo data into a long-lived stale cache.
const GET_CACHE_TTL_MS = 20_000;
const getCache = new Map();
const getInFlight = new Map();

function invalidateGetCache() {
  getCache.clear();
}

async function request(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const isGet = method === "GET";
  const token = sessionStorage.getItem("ps_token") || "";
  const cacheKey = isGet ? token + "::" + path : path;
  const now = Date.now();

  if (isGet) {
    const cached = getCache.get(cacheKey);
    if (cached && now - cached.at < GET_CACHE_TTL_MS) {
      return cached.body;
    }
    const pending = getInFlight.get(cacheKey);
    if (pending) return pending;
  }

  const run = (async () => {
    const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (res.status === 401) {
    // Session token missing/rejected by the server - clear it and let the
    // app redirect to /login rather than continuing to fail silently.
    sessionStorage.removeItem("ps_token");
    window.dispatchEvent(new Event("ps:unauthorized"));
  }
  const raw = await res.text();
  let body = null;
  if (raw) {
    try { body = JSON.parse(raw); } catch { throw new Error(`Server returned invalid JSON (${res.status})`); }
  }
  if (!res.ok) {
    throw new Error(body?.message || `Request failed: ${res.status}`);
  }
    if (body === null) throw new Error(`Server returned an empty response (${res.status})`);
    if (isGet) getCache.set(cacheKey, { at: Date.now(), body });
    return body;
  })();

  if (isGet) {
    getInFlight.set(cacheKey, run);
    try {
      return await run;
    } finally {
      getInFlight.delete(cacheKey);
    }
  }

  invalidateGetCache();
  return run;
}

async function requestBlob(path, options = {}) {
  const token = sessionStorage.getItem("ps_token");
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed: ${res.status}`);
  }
  return res.blob();
}

export function warmup() { return fetch(`${BASE}/ping`, { method: "GET", cache: "no-store" }).catch(() => null); }

export const api = {
  login: (username, password) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  dashboard: () => request("/dashboard"),
  tenders: (status = "") => request(`/tenders${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  tenderDetail: (tenderId) => request(`/tenders/${encodeURIComponent(tenderId)}`),
  officerTenderDetail: (tenderId) => request(`/officer/tenders/${encodeURIComponent(tenderId)}`),
  createTender: (payload) => request("/officer/tenders", { method: "POST", body: JSON.stringify(payload) }),
  updateTender: (tenderId, payload) => request(`/officer/tenders/${encodeURIComponent(tenderId)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteTender: (tenderId) => request(`/officer/tenders/${encodeURIComponent(tenderId)}`, { method: "DELETE" }),
  submitBid: (payload) => request("/bidder/bids", { method: "POST", body: JSON.stringify(payload) }),
  bidderBids: () => request("/bidder/bids"),
  bids: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    return request(`/bids?${qs.toString()}`);
  },
  bidsExportCsv: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    return requestBlob(`/bids/export.csv?${qs.toString()}`);
  },
  reportCsv: (type) => requestBlob(`/reports/${type}/csv`),
  bidDetail: (bidId) => request(`/bid-detail?bid_id=${encodeURIComponent(bidId)}`),
  bidders: () => request("/bidders"),
  bidderDetail: (bidderId) => request(`/bidders/${encodeURIComponent(bidderId)}`),
  bidFile: (bidId, index = 0) => requestBlob(`/bids/${encodeURIComponent(bidId)}/files/${index}`),
  network: () => request("/network"),
  networkForBidder: (bidderId) => request(`/network/${bidderId}`),
  cluster: (clusterId) => request(`/network/cluster/${clusterId}`),
  alerts: () => request("/alerts"),
  auditLog: () => request("/audit-log"),
  aiAnalyze: (mode, payload) =>
    request("/ai/analyze", { method: "POST", body: JSON.stringify({ mode, payload }) }),
  report: (type) => request(`/reports/${type}`),
  // Engine control surface (proxied to the Python ProcureShield service)
  engineStatus: () => request("/engine/status"),
  engineRefresh: (train = false) =>
    request("/engine/refresh", { method: "POST", body: JSON.stringify({ train }) }),
  engineTrain: (opts = {}) =>
    request("/engine/train", { method: "POST", body: JSON.stringify(opts) }),
  verificationAction: (bidId, action, comment) =>
    request(`/verification/${encodeURIComponent(bidId)}/${action}`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    }),
  intelligencePdf: (payload) => request("/intelligence/pdf", { method: "POST", body: JSON.stringify(payload) }),
  intelligenceRequirements: (text) => request("/intelligence/requirements", { method: "POST", body: JSON.stringify({ text }) }),
  intelligenceValidateDocument: (payload) => request("/intelligence/validate-document", { method: "POST", body: JSON.stringify(payload) }),
  intelligenceEligibility: (payload) => request("/intelligence/eligibility", { method: "POST", body: JSON.stringify(payload) }),
  intelligenceAIRequirements: (text) => request("/intelligence/ai-requirements", { method: "POST", body: JSON.stringify({ text }) }),
  intelligenceAIDocumentCheck: (payload) => request("/intelligence/ai-document-check", { method: "POST", body: JSON.stringify(payload) }),
};
