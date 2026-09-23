const BASE = "/api";

async function request(path, options = {}) {
  const token = sessionStorage.getItem("ps_token");
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
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed: ${res.status}`);
  }
  return res.json();
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
  governmentVerification: (bidderId) => request(`/gov/verify/${encodeURIComponent(bidderId)}`),
  bids: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    return request(`/bids?${qs.toString()}`);
  },
  bidsExportCsv: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    return requestBlob(`/bids/export.csv?${qs.toString()}`);
  },
  reportCsv: (type) => requestBlob(`/reports/${type}/csv`),
  bidDetail: (bidId) => request(`/bids/${encodeURIComponent(bidId)}`),
  bidders: () => request("/bidders"),
  bidderDetail: (bidderId) => request(`/bidders/${bidderId}`),
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
  intelligenceAIRequirements: (text) => request("/intelligence/ai-requirements", { method: "POST", body: JSON.stringify({ text }) }),\n  intelligenceAIDocumentCheck: (payload) => request("/intelligence/ai-document-check", { method: "POST", body: JSON.stringify(payload) }),
  intelligenceValidateDocument: (payload) => request("/intelligence/validate-document", { method: "POST", body: JSON.stringify(payload) }),
  intelligenceEligibility: (payload) => request("/intelligence/eligibility", { method: "POST", body: JSON.stringify(payload) }),
};
