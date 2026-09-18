// aiEngine.js
// Abstraction layer for AI-assisted explanations.
//
// SAFEGUARD: the model (real or mock) NEVER receives free-form instructions
// to "decide" anything, and NEVER invents bidder data. It is only ever asked
// to phrase, in plain language, a set of structured, pre-verified signals
// that were computed by riskEngine.js. Every sentence it can produce must be
// traceable to a signal in the "evidence" array we pass in.
//
// If ANTHROPIC_API_KEY is not set, a deterministic mock engine is used so the
// UI works fully offline / without any external dependency.

const SIGNAL_TEXT = {
  sharedDirector: "the two bidders list the same registered director",
  sharedAddress: "the two bidders' registered addresses are the same or highly similar",
  sharedPhone: "the two bidders share the same registered contact phone number",
  sharedBank: "the two bidders share the same registered bank account number",
  similarGstPan: "the two bidders' GST/PAN identifiers share an unusually similar structure",
  similarBiddingBehavior: "the two bidders have repeatedly bid on the same tender categories",
};

const DISCLAIMER =
  "AI-generated analysis is advisory. Final procurement decisions must be made by an authorized officer.";

function mockAnalyzeRelationship({ bidderA, bidderB, evidence, score, category }) {
  const findings = evidence.map((sig) => ({
    signal: sig,
    text: SIGNAL_TEXT[sig] || sig,
  }));

  const summaryParts = findings.map((f) => f.text);
  let narrative;
  if (summaryParts.length === 0) {
    narrative = `No structural relationship signals were found between ${bidderA} and ${bidderB} in the supplied dataset.`;
  } else {
    narrative =
      `${bidderA} and ${bidderB}: ` +
      summaryParts.join("; ") +
      `. This relationship has been detected in the supplied dataset and may require manual verification. ` +
      `Potential relationship detected — manual verification required.`;
  }

  return {
    narrative,
    findings,
    score,
    category,
    disclaimer: DISCLAIMER,
    source: "mock-engine",
  };
}

function mockChecklistExplanation({ item, status, confidence }) {
  const templates = {
    verified: `${item} was checked against expected format and structural rules and did not raise any inconsistency in the submitted data.`,
    warning: `${item} could not be fully auto-verified. A related signal was found in the dataset that a procurement officer should review manually before proceeding.`,
    failed: `${item} did not match the expected format or reference data supplied with the bid.`,
  };
  return {
    text: templates[status] || `${item}: automated check completed.`,
    confidence,
    disclaimer: DISCLAIMER,
    source: "mock-engine",
  };
}

function mockInvestigationSummary({ clusterId, members, evidence, riskScore, category }) {
  const evidenceText = evidence.map((e) => SIGNAL_TEXT[e] || e).join("; ") || "no strong signals";
  return {
    narrative:
      `Investigation summary for ${clusterId}: ${members.length} bidders (${members.join(", ")}) ` +
      `were grouped because ${evidenceText}. The aggregate relationship-risk score is ${riskScore}/100 ` +
      `(${category} review priority). This indicates a pattern that warrants manual verification by ` +
      `an authorized procurement officer. It is not, by itself, evidence of fraud, cartel formation, or collusion.`,
    evidence,
    riskScore,
    category,
    disclaimer: DISCLAIMER,
    source: "mock-engine",
  };
}

/**
 * Real LLM call (only used if ANTHROPIC_API_KEY is configured).
 * The prompt strictly constrains the model to the supplied structured data.
 */
async function realAnalyze(payload) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const system =
    "You are a procurement compliance assistant. You are given ONLY structured, pre-verified " +
    "relationship signals about bidders on India's Government e-Marketplace (GeM), synthetic/sandbox data. " +
    "You must NOT invent any bidder information, documents, financial details, or relationships beyond what " +
    "is given. You must NEVER assert fraud, cartel activity, or criminal wrongdoing. Always phrase findings as " +
    "'potential relationship detected - manual verification required' and always end by noting the final decision " +
    "rests with the procurement officer. Respond concisely in 2-4 sentences.";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    }),
  });
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return {
    narrative: text || "AI analysis unavailable.",
    disclaimer: DISCLAIMER,
    source: "anthropic-live",
  };
}

export async function analyzeRelationship(params) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await realAnalyze({ type: "relationship", ...params });
    } catch (e) {
      console.error("Live AI call failed, falling back to mock engine:", e.message);
    }
  }
  return mockAnalyzeRelationship(params);
}

export async function explainChecklistItem(params) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await realAnalyze({ type: "checklist", ...params });
    } catch (e) {
      console.error("Live AI call failed, falling back to mock engine:", e.message);
    }
  }
  return mockChecklistExplanation(params);
}

export async function summarizeInvestigation(params) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await realAnalyze({ type: "investigation_summary", ...params });
    } catch (e) {
      console.error("Live AI call failed, falling back to mock engine:", e.message);
    }
  }
  return mockInvestigationSummary(params);
}

export { DISCLAIMER };
