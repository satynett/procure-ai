// Synthetic government verification datasets for prototype/demo use.
// These records are fictional and stored in PostgreSQL like mock government registries.

const tables = {
  gstn: "sandbox_gstn",
  mca21: "sandbox_mca21",
  udyam: "sandbox_udyam",
  epfo: "sandbox_epfo",
  digilocker: "sandbox_digilocker",
  blacklist: "sandbox_blacklist",
};

function udyamFor(bidder, i) {
  return "UDYAM-SBX-" + String(1000000 + i).padStart(7, "0");
}

export function buildGovernmentSandboxSeed(bidders) {
  return {
    gstn: bidders.map((b, i) => ({
      gstin: String(b.gst_number || "").toUpperCase(),
      legal_name: b.company_name,
      registration_status: i === 16 ? "Suspended" : "Active",
      state: String(b.address || "").split(",").pop()?.trim() || "India",
      filing_status: i === 16 ? "Return filing pending (synthetic)" : "Compliant (synthetic)",
      last_filing_date: "2026-08-31",
    })),
    mca21: bidders.map((b, i) => ({
      cin: "U" + String(10000 + i).padStart(5, "0") + "SBX2026PTC" + String(1 + i).padStart(6, "0"),
      company_name: b.company_name,
      company_status: i === 17 ? "Under Process" : "Active",
      incorporation_date: "2019-04-15",
      director_name: b.director_name,
    })),
    udyam: bidders.map((b, i) => ({
      udyam_number: udyamFor(b, i),
      enterprise_name: b.company_name,
      enterprise_status: b.msme_status === "Yes" ? "Active" : "Not Registered",
      category: b.msme_status === "Yes" ? (i % 2 ? "Small" : "Micro") : null,
      pan_match: b.msme_status === "Yes",
      registration_date: "2023-06-12",
    })),
    epfo: bidders.map((b, i) => ({
      establishment_id: "EPFO-SBX-" + String(20001 + i),
      employer_name: b.company_name,
      establishment_status: "Active",
      employee_count: 18 + (i * 7),
      compliance_status: i === 15 ? "Needs Review" : "Current (synthetic)",
      last_contribution: "2026-08-31",
    })),
    digilocker: bidders.map((b, i) => ({
      document_id: "DOC-SBX-" + String(30001 + i),
      holder_name: b.company_name,
      issuer: "Government Issuer Sandbox",
      document_type: "Business Registration / Supporting Document",
      document_status: i === 14 ? "Needs Review" : "Verified",
      issued_on: "2025-01-20",
    })),
    blacklist: bidders.map((b, i) => ({
      identifier: b.gst_number,
      entity_name: b.company_name,
      registry_status: i === 16 ? "Review Required" : "No Match",
      match_type: "Synthetic debarment registry",
      last_checked: "2026-09-23",
    })),
  };
}

export async function initGovernmentSandbox(pool, bidders, { seed = true } = {}) {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS sandbox_gstn (gstin TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" +
    "CREATE TABLE IF NOT EXISTS sandbox_mca21 (cin TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" +
    "CREATE TABLE IF NOT EXISTS sandbox_udyam (udyam_number TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" +
    "CREATE TABLE IF NOT EXISTS sandbox_epfo (establishment_id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" +
    "CREATE TABLE IF NOT EXISTS sandbox_digilocker (document_id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" +
    "CREATE TABLE IF NOT EXISTS sandbox_blacklist (identifier TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());"
  );

  const datasets = buildGovernmentSandboxSeed(bidders);
  const definitions = [
    [tables.gstn, "gstin", datasets.gstn],
    [tables.mca21, "cin", datasets.mca21],
    [tables.udyam, "udyam_number", datasets.udyam],
    [tables.epfo, "establishment_id", datasets.epfo],
    [tables.digilocker, "document_id", datasets.digilocker],
    [tables.blacklist, "identifier", datasets.blacklist],
  ];

  for (const [table, key, rows] of definitions) {
    const count = (await pool.query("SELECT COUNT(*)::int AS count FROM " + table)).rows[0].count;
    if (seed && count === 0) {
      for (const row of rows) {
        await pool.query(
          "INSERT INTO " + table + " (" + key + ", data) VALUES ($1, $2::jsonb)",
          [row[key], JSON.stringify(row)]
        );
      }
      console.log("PostgreSQL: seeded " + rows.length + " synthetic " + table + " records.");
    }
  }
}

export { tables };
