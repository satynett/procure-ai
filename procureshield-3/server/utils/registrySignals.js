// registrySignals.js
// Two exact-match identity checks the ProcureShield Engine cannot perform,
// because its graph schema has no Phone or BankAccount node type: a shared
// registered contact number and a shared registered bank account.
//
// These are deterministic string equality checks on registry fields, not
// scores or heuristics. They add evidence to a relationship; they never
// change a risk score - every score in this application comes from the
// engine. Like every other signal here, a match is a reason to look, not a
// finding of wrongdoing (two firms can legitimately share an accountant's
// contact number, and data-entry errors are common).

function exactGroups(bidders, field) {
  const groups = new Map();
  bidders.forEach((b) => {
    const value = b[field];
    if (!value) return;
    const key = String(value).trim();
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b.bidder_id);
  });
  return Array.from(groups.values()).filter((ids) => ids.length > 1);
}

/**
 * Returns edges of shape {source, target, evidence[], reasons[]} for every
 * pair of bidders sharing a phone number or a bank account.
 */
export function registryEdges(bidders) {
  const edges = new Map();
  const add = (a, b, evidence, reason) => {
    const [source, target] = [a, b].sort();
    const key = `${source}::${target}`;
    if (!edges.has(key)) edges.set(key, { source, target, evidence: [], reasons: [] });
    const edge = edges.get(key);
    if (!edge.evidence.includes(evidence)) edge.evidence.push(evidence);
    edge.reasons.push(reason);
  };

  exactGroups(bidders, "phone").forEach((ids) => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        add(ids[i], ids[j], "sharedPhone", "registered against the same contact phone number");
      }
    }
  });

  exactGroups(bidders, "bank_account").forEach((ids) => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        add(ids[i], ids[j], "sharedBank", "registered against the same bank account number");
      }
    }
  });

  return Array.from(edges.values());
}

/** Evidence codes that apply to a single bidder, for the checklist. */
export function registryEvidenceFor(bidderId, edges) {
  const codes = new Set();
  edges
    .filter((e) => e.source === bidderId || e.target === bidderId)
    .forEach((e) => e.evidence.forEach((c) => codes.add(c)));
  return Array.from(codes);
}
