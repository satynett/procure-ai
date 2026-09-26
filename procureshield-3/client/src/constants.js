// constants.js
// Display metadata for the risk signals produced by the ProcureShield Engine.
//
// These labels are for rendering only. Scores, severities and weights are
// NOT defined here - they come from the engine with every response (see the
// `signal_breakdown` array on clusters and `risk_signals` on entities).
// The `weight` values below are the engine's configured signal weights,
// mirrored so a label can still be shown if a payload omits them.

export const WEIGHT_LABELS = {
  // Structural identity signals (engine)
  sharedDirector: { label: "Shared Director", weight: 1.0 },
  sharedAddress: { label: "Shared Address", weight: 0.8 },

  // Behavioural signals (engine) - these need multi-bidder tenders to fire
  repeatedCoBidding: { label: "Repeated Co-Bidding", weight: 0.9 },
  bidPriceSimilarity: { label: "Bid Price Similarity", weight: 0.8 },
  duplicateBidDocuments: { label: "Identical Bid Documents", weight: 1.2 },
  coverBidPattern: { label: "Cover Bid Pattern", weight: 0.95 },
  winnerRotation: { label: "Winner Rotation", weight: 1.0 },
  marketConcentration: { label: "Market Concentration", weight: 0.7 },
  highCentrality: { label: "High Network Centrality", weight: 0.5 },
  denseSubgroup: { label: "Dense Bidding Subgroup", weight: 0.7 },
  uncontestedAwards: { label: "Uncontested Awards", weight: 0.6 },

  // Registry signals computed by the BFF (the engine graph has no phone or
  // bank-account node type) - see server/utils/registrySignals.js
  sharedPhone: { label: "Shared Phone Number", weight: null },
  sharedBank: { label: "Shared Bank Account", weight: null },
};

export function labelFor(code) {
  return WEIGHT_LABELS[code]?.label || code;
}

/** Risk band boundaries, mirroring the engine's RiskBands. */
export const RISK_BANDS = { low: 25, medium: 50, high: 75 };
