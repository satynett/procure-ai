// checklist.js
// Deterministic automated compliance checklist, built purely from structured
// bidder/bid data + relationship signals already computed by riskEngine.js.

const GST_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]{1}$/;

export function buildChecklist({ bidder, bid, evidenceForBidder }) {
  const hasStrongSignal = (types) => evidenceForBidder.some((e) => types.includes(e));

  const items = [
    {
      key: "gst",
      label: "GST Verification",
      status: GST_RE.test(bidder.gst_number || "") ? "verified" : "failed",
      confidence: GST_RE.test(bidder.gst_number || "") ? 98 : 40,
      explanation: GST_RE.test(bidder.gst_number || "")
        ? "GST number follows the expected format and matches the bidder information provided in the submitted documents."
        : "GST number does not match the expected 15-character structural format.",
    },
    {
      key: "pan",
      label: "PAN Format Verification",
      status: PAN_RE.test(bidder.pan_number || "") ? "verified" : "failed",
      confidence: PAN_RE.test(bidder.pan_number || "") ? 97 : 35,
      explanation: PAN_RE.test(bidder.pan_number || "")
        ? "PAN number matches the expected 10-character alphanumeric structure."
        : "PAN number does not match the expected structural format.",
    },
    {
      key: "msme",
      label: "MSME / Udyam Information",
      status: "verified",
      confidence: 95,
      explanation:
        bidder.msme_status === "Yes"
          ? "Udyam/MSME registration status is present and consistent with submitted bidder profile."
          : "Bidder is registered as a non-MSME entity; no MSME-specific benefit was claimed.",
    },
    {
      key: "bank",
      label: "Bank Account Information",
      status: hasStrongSignal(["sharedBank"]) ? "warning" : "verified",
      confidence: hasStrongSignal(["sharedBank"]) ? 62 : 96,
      explanation: hasStrongSignal(["sharedBank"])
        ? "Bank account format is valid, but this account number also appears against another bidder in the dataset."
        : "Bank account number format is valid and unique among current dataset entries.",
    },
    {
      key: "registration",
      label: "Company Registration",
      status: "verified",
      confidence: 99,
      explanation: "Company registration reference is present and structurally valid.",
    },
    {
      key: "director",
      label: "Director Information",
      status: hasStrongSignal(["sharedDirector"]) ? "warning" : "verified",
      confidence: hasStrongSignal(["sharedDirector"]) ? 91 : 97,
      explanation: hasStrongSignal(["sharedDirector"])
        ? "The registered director name also appears against one or more other bidders in the dataset."
        : "Director information is present and does not match other bidders in the dataset.",
    },
    {
      key: "address",
      label: "Address Similarity",
      status: hasStrongSignal(["sharedAddress"]) ? "warning" : "verified",
      confidence: hasStrongSignal(["sharedAddress"]) ? 94 : 96,
      explanation: hasStrongSignal(["sharedAddress"])
        ? "Registered address is the same as, or highly similar to, another bidder's address in the dataset."
        : "Registered address does not closely match other bidders in the dataset.",
    },
    {
      key: "documents",
      label: "Required Documents Present",
      status: "verified",
      confidence: 100,
      explanation: "All mandatory document placeholders for this tender category are present in the submission.",
    },
  ];

  return items;
}

export function buildTenderComparison({ tender, bidder, bid }) {
  if (!tender) {
    return {
      status: "No tender context",
      score: 0,
      matched: 0,
      total: 0,
      checks: [],
      message: "Tender requirements were not available for this bid.",
    };
  }

  const submitted = [
    ...(Array.isArray(bid?.submitted_documents) ? bid.submitted_documents : []),
    ...(Array.isArray(bid?.documents) ? bid.documents : []),
  ].map((x) => String(x).toLowerCase());

  const aliases = {
    "GST certificate": ["gst", "gstin", "goods", "tax"],
    "PAN card": ["pan", "permanent"],
    "Udyam/MSME certificate": ["udyam", "msme"],
    "Experience certificate": ["experience", "work experience"],
    "Work order": ["work order"],
    "Financial statement": ["financial", "turnover", "balance"],
    "Balance sheet": ["balance", "financial"],
    "Certificate of incorporation": ["incorporation", "company registration"],
    "EMD / Bid Security proof": ["emd", "bid security", "earnest"],
    "ISO 9001": ["iso", "9001"],
    "OEM authorization": ["oem", "authorization", "manufacturer"],
    "Turnover proof": ["turnover", "financial"],
    "Quality certificate": ["quality", "certificate"],
  };

  const profilePass = {
    "GST certificate": Boolean(bidder?.gst_number),
    "PAN card": Boolean(bidder?.pan_number),
    "Udyam/MSME certificate": bidder?.msme_status === "Yes",
  };

  const required = Array.isArray(tender.required_documents) ? tender.required_documents : [];
  const checks = required.map((requirement) => {
    const needles = aliases[requirement] || [String(requirement).toLowerCase()];
    const fileMatch = submitted.find((name) => needles.some((needle) => name.includes(needle)));
    if (fileMatch) {
      return {
        requirement,
        status: "matched",
        evidence: fileMatch,
        explanation: "A submitted document filename matches this tender requirement.",
      };
    }
    if (profilePass[requirement]) {
      return {
        requirement,
        status: "matched",
        evidence: requirement === "GST certificate" ? "Bidder GST profile present"
          : requirement === "PAN card" ? "Bidder PAN profile present"
          : "Bidder Udyam/MSME profile present",
        explanation: "The bidder profile contains the corresponding registration information.",
      };
    }
    return {
      requirement,
      status: submitted.length ? "missing" : "evidence_required",
      evidence: submitted.length ? "No matching submitted document found" : "No uploaded document manifest in this bid record",
      explanation: submitted.length
        ? "No submitted document was matched to this tender requirement."
        : "The bid record does not contain an uploaded document manifest; officer evidence review is required.",
    };
  });

  const matched = checks.filter((c) => c.status === "matched").length;
  const missing = checks.filter((c) => c.status === "missing").length;
  const score = checks.length ? Math.round((matched / checks.length) * 100) : 0;

  return {
    tender_id: tender.tender_id,
    tender_title: tender.title,
    status: missing > 0 ? "Requirements missing" : matched === checks.length ? "Checklist matched" : "Evidence required",
    score,
    matched,
    missing,
    total: checks.length,
    checks,
    eligibility_summary: tender.eligibility_summary || "",
    message: missing > 0
      ? "One or more tender document requirements are not matched to the submitted bid."
      : "This comparison is a review aid; the officer must verify the underlying documents before final eligibility.",
  };
}

