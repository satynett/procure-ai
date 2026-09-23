// Government Verification Sandbox
// Synthetic, API-compatible verification data for prototype/demo use.
// This module intentionally does not call live government systems.

function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

function result(source, check, status, details) {
  return {
    source,
    check,
    status,
    verified_at: new Date().toISOString(),
    verification_id: `SBX-${source.replace(/[^A-Z0-9]/g, "")}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    ...details,
  };
}

export function verifyGovernmentRecords(bidder = {}) {
  const gstin = normalize(bidder.gst_number || "");
  const udyam = normalize(bidder.udyam_number || "");
  const pan = normalize(bidder.pan_number || "");
  const company = bidder.company_name || "Unknown Bidder";
  const address = bidder.address || "Synthetic registered address";

  return {
    sandbox: true,
    disclaimer: "Synthetic sandbox records for prototype validation. Not live government data.",
    bidder_id: bidder.bidder_id || null,
    company_name: company,
    checks: [
      result("GSTN_SANDBOX", "GST registration", "Verified", {
        gstin: gstin || "22AAAAA0000A1Z5",
        registration_status: "Active",
        legal_name: company,
        legal_name_match: true,
        state: String(address).split(",").pop()?.trim() || "India",
        filing_status: "Compliant (synthetic)",
      }),
      result("MCA21_SANDBOX", "Company registration", "Verified", {
        cin: "U00000SBX2026PTC000001",
        company_name: company,
        company_status: "Active",
        incorporation_date: "2019-04-15",
        director_check: "Available (synthetic)",
      }),
      result("UDYAM_SANDBOX", "MSME registration", "Verified", {
        udyam_number: udyam || "UDYAM-SBX-00-0000000",
        enterprise_name: company,
        enterprise_status: "Active",
        category: bidder.msme_status || "Small",
        pan_match: Boolean(pan || gstin),
      }),
      result("EPFO_ESIC_SANDBOX", "Establishment compliance", "Verified", {
        establishment_status: "Active",
        employee_count: 48,
        compliance_status: "Current (synthetic)",
        last_contribution: "2026-08-31",
      }),
      result("DIGILOCKER_SANDBOX", "Document issuer check", "Verified", {
        document_id: "DOC-SBX-" + String(bidder.bidder_id || "0001").replace(/[^A-Z0-9-]/gi, ""),
        issuer: "Government Issuer Sandbox",
        document_status: "Verified",
      }),
      result("BLACKLIST_SANDBOX", "Blacklist / debarment check", "Clear", {
        registry_status: "No Match",
        match_type: "Synthetic registry",
      }),
    ],
  };
}

export function verifyBidderById(bidders, bidderId) {
  const bidder = bidders.find((b) => b.bidder_id === bidderId);
  if (!bidder) return null;
  return verifyGovernmentRecords(bidder);
}
