// PostgreSQL-backed Government Verification Sandbox.
// All records are fictional synthetic data for prototype/demo validation.
// No live government systems are called.

import { pool } from "../db/store.js";

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

async function findRecord(table, field, value) {
  const result = await pool.query(
    "SELECT data FROM " + table + " WHERE UPPER(data->>$1) = UPPER($2) LIMIT 1",
    [field, String(value || "")]
  );
  return result.rows[0]?.data || null;
}

export async function verifyGovernmentRecords(bidder = {}) {
  const gstin = normalize(bidder.gst_number || "");
  const company = bidder.company_name || "Unknown Bidder";

  const [gst, mca, udyam, epfo, digilocker, blacklist] = await Promise.all([
    findRecord("sandbox_gstn", "gstin", gstin),
    findRecord("sandbox_mca21", "company_name", company),
    findRecord("sandbox_udyam", "enterprise_name", company),
    findRecord("sandbox_epfo", "employer_name", company),
    findRecord("sandbox_digilocker", "holder_name", company),
    findRecord("sandbox_blacklist", "identifier", gstin),
  ]);

  const checks = [
    gst
      ? result("GSTN_SANDBOX", "GST registration", gst.registration_status === "Active" ? "Verified" : "Needs Review", gst)
      : result("GSTN_SANDBOX", "GST registration", "Not Found", { gstin }),
    mca
      ? result("MCA21_SANDBOX", "Company registration", mca.company_status === "Active" ? "Verified" : "Needs Review", mca)
      : result("MCA21_SANDBOX", "Company registration", "Not Found", { company_name: company }),
    udyam
      ? result("UDYAM_SANDBOX", "MSME registration", udyam.enterprise_status === "Active" ? "Verified" : "Not Registered", udyam)
      : result("UDYAM_SANDBOX", "MSME registration", "Not Found", { enterprise_name: company }),
    epfo
      ? result("EPFO_ESIC_SANDBOX", "Establishment compliance", epfo.compliance_status === "Current (synthetic)" ? "Verified" : "Needs Review", epfo)
      : result("EPFO_ESIC_SANDBOX", "Establishment compliance", "Not Found", { employer_name: company }),
    digilocker
      ? result("DIGILOCKER_SANDBOX", "Document issuer check", digilocker.document_status === "Verified" ? "Verified" : "Needs Review", digilocker)
      : result("DIGILOCKER_SANDBOX", "Document issuer check", "Not Found", { holder_name: company }),
    blacklist
      ? result("BLACKLIST_SANDBOX", "Blacklist / debarment check", blacklist.registry_status === "No Match" ? "Clear" : "Needs Review", blacklist)
      : result("BLACKLIST_SANDBOX", "Blacklist / debarment check", "No Record", { identifier: gstin }),
  ];

  return {
    sandbox: true,
    data_source: "PostgreSQL synthetic government registry datasets",
    disclaimer: "Synthetic sandbox records for prototype validation. Not live government data.",
    bidder_id: bidder.bidder_id || null,
    company_name: company,
    checks,
  };
}

export async function verifyBidderById(bidders, bidderId) {
  const bidder = bidders.find((b) => b.bidder_id === bidderId);
  if (!bidder) return null;
  return verifyGovernmentRecords(bidder);
}
