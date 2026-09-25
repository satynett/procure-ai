import dotenv from "dotenv";
dotenv.config();
import pg from "pg";
import { seedData, makeRfpPdfBase64 } from "./seed.js";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
const sslEnabled = String(process.env.DATABASE_SSL || "").toLowerCase() === "true" ||
  Boolean(connectionString && /sslmode=require/i.test(connectionString));

export const pool = new Pool({
  ...(connectionString ? { connectionString } : {}),
  ...(sslEnabled ? { ssl: { rejectUnauthorized: false } } : {}),
  max: Number(process.env.DATABASE_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => console.error("PostgreSQL pool error:", err.message));

const cache = new Map();
const TABLES = { bidders:"procure_bidders", bids:"procure_bids", tenders:"procure_tenders", auditLog:"procure_audit_logs" };
const KEY_FIELDS = { bidders:"bidder_id", bids:"bid_id", tenders:"tender_id", auditLog:"id" };

export async function initDatabase({ seed=true }={}) {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS procure_bidders (bidder_id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" +
    "CREATE TABLE IF NOT EXISTS procure_bids (bid_id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" +
    "CREATE TABLE IF NOT EXISTS procure_tenders (tender_id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" +
    "CREATE TABLE IF NOT EXISTS procure_audit_logs (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" +
    "CREATE INDEX IF NOT EXISTS idx_procure_bids_tender ON procure_bids ((data->>'tender_id'));" +
    "CREATE INDEX IF NOT EXISTS idx_procure_bids_bidder ON procure_bids ((data->>'bidder_id'));" +
    "CREATE INDEX IF NOT EXISTS idx_procure_tenders_status ON procure_tenders ((data->>'status'));"
  );
  for (const [collection, rows] of Object.entries(seedData)) {
    const table=TABLES[collection], key=KEY_FIELDS[collection];
    const count=(await pool.query("SELECT COUNT(*)::int AS count FROM " + table)).rows[0].count;
    if (seed && count===0 && rows.length) {
      for (const row of rows) {
        await pool.query(
          "INSERT INTO " + table + " (" + key + ", data) VALUES ($1, $2::jsonb)",
          [row[key], JSON.stringify(row)]
        );
      }
      console.log("PostgreSQL: seeded " + rows.length + " " + collection + " records.");
    }
    await refreshCache(collection);
  }

  // Keep the existing database aligned with the synthetic multi-cluster
  // network used by the demo. This only changes fictional relationship fields.
  const networkDemoLinks = [
    ["BID-2002", { director_name: "Amit Verma" }],
    ["BID-2003", { address: "12, Industrial Area, New Delhi, Delhi" }],
    ["BID-2004", { address: "12, Industrial Area, New Delhi, Delhi" }],
    ["BID-2006", { director_name: "Vivek Rao" }],
    ["BID-2007", { address: "16, Industrial Area, Pune, Maharashtra" }],
    ["BID-2009", { director_name: "Ananya Menon" }],
    ["BID-2010", { address: "19, Industrial Area, Jaipur, Rajasthan" }],
    ["BID-2012", { director_name: "Aditya Tiwari" }],
    ["BID-2013", { address: "22, Industrial Area, Ahmedabad, Gujarat" }],
  ];
  const bidderRows = getCollection("bidders");
  let bidderLinksChanged = false;
  for (const [bidderId, patch] of networkDemoLinks) {
    const row = bidderRows.find((item) => item.bidder_id === bidderId);
    if (!row) continue;
    for (const [field, value] of Object.entries(patch)) {
      if (row[field] !== value) {
        row[field] = value;
        bidderLinksChanged = true;
      }
    }
  }
  if (bidderLinksChanged) {
    await replaceCollection("bidders", bidderRows);
    console.log("PostgreSQL: applied synthetic multi-cluster relationship links.");
  }

  // Existing demo rows were originally stored as plain-text base64.
  // Convert only those rows to real PDF bytes; never touch an already uploaded PDF.
  const tenderRows = getCollection("tenders");
  let migrated = 0;
  for (const tender of tenderRows) {
    const base64 = String(tender.rfp_content_base64 || "");
    if (!base64 || base64.startsWith("JVBERi0")) continue;

    const pdfBase64 = makeRfpPdfBase64(tender);
    await pool.query(
      "UPDATE procure_tenders SET data = jsonb_set(data, '{rfp_content_base64}', to_jsonb($1::text), true), updated_at = NOW() WHERE tender_id = $2",
      [pdfBase64, tender.tender_id]
    );
    migrated += 1;
  }
  if (migrated) {
    console.log("PostgreSQL: converted " + migrated + " demo RFPs into PDF documents.");
    await refreshCache("tenders");
  }
}

export async function refreshCache(collection) {
  const orderColumn = collection === "auditLog" ? "created_at" : "updated_at";
  const result=await pool.query("SELECT data FROM " + TABLES[collection] + " ORDER BY " + orderColumn + " DESC");
  cache.set(collection,result.rows.map(r=>r.data));
}

export function getCollection(collection) {
  const rows=cache.get(collection);
  if (!rows) throw new Error("Database collection not initialized: " + collection);
  return rows.map(row=>({...row}));
}

export async function replaceCollection(collection, rows) {
  const table=TABLES[collection], key=KEY_FIELDS[collection], client=await pool.connect();
  try {
    await client.query("BEGIN");

    // IMPORTANT: never rebuild a collection with DELETE + INSERT.
    // The UI works with array-shaped snapshots, but PostgreSQL is the
    // persistent source of truth. A DELETE here used to erase newly-created
    // bids/bidders whenever another route wrote a stale snapshot back.
    //
    // Upsert only the records explicitly changed by the caller. Existing
    // records that are not present in this snapshot remain untouched.
    for (const row of rows) {
      if (!row?.[key]) continue;
      await client.query(
        "INSERT INTO " + table + " (" + key + ", data) VALUES ($1, $2::jsonb) " +
        "ON CONFLICT (" + key + ") DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()",
        [row[key], JSON.stringify(row)]
      );
    }

    await client.query("COMMIT");
    await refreshCache(collection);
  } catch(err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}


export async function createBidSubmission({ companyName, bidData }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize bidder creation so two rapid submissions cannot generate the
    // same BID-* primary key from the same cached dataset.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('procureshield-bidder-create'))");

    const existing = await client.query(
      "SELECT data FROM procure_bidders WHERE lower(trim(data->>'company_name')) = lower(trim($1)) LIMIT 1 FOR UPDATE",
      [companyName]
    );

    let bidder;
    if (existing.rowCount) {
      bidder = existing.rows[0].data;
    } else {
      const ids = await client.query(
        "SELECT COALESCE(MAX(NULLIF(regexp_replace(bidder_id, '\\D', '', 'g'), '')::bigint), 1000) AS max_id FROM procure_bidders"
      );
      const nextNumber = Number(ids.rows[0].max_id || 1000) + 1;
      bidder = {
        bidder_id: `BID-${nextNumber}`,
        company_name: companyName,
        director_name: null,
        address: null,
        phone: null,
        email: null,
        gst_number: null,
        pan_number: null,
        bank_account: "",
        msme_status: "Not provided",
        bids: [],
        label: null,
      };
      await client.query(
        "INSERT INTO procure_bidders (bidder_id, data) VALUES ($1, $2::jsonb)",
        [bidder.bidder_id, JSON.stringify(bidder)]
      );
    }

    const bidIdResult = await client.query(
      "SELECT COALESCE(MAX(NULLIF(regexp_replace(bid_id, '\\D', '', 'g'), '')::bigint), 0) AS max_id FROM procure_bids WHERE bid_id LIKE 'DEMO/BID/%'"
    );
    const sequence = Number(bidIdResult.rows[0].max_id || 0) + 1;
    const bid = {
      ...bidData,
      bid_id: `DEMO/BID/2026/${String(sequence).padStart(4, "0")}`,
      bidder_id: bidder.bidder_id,
      bidder_company_name: bidder.company_name,
    };

    const updatedBidder = {
      ...bidder,
      bids: [...(Array.isArray(bidder.bids) ? bidder.bids : []), { bid_id: bid.bid_id, category: bid.category }],
    };

    await client.query(
      "UPDATE procure_bidders SET data = $1::jsonb, updated_at = NOW() WHERE bidder_id = $2",
      [JSON.stringify(updatedBidder), bidder.bidder_id]
    );
    await client.query(
      "INSERT INTO procure_bids (bid_id, data) VALUES ($1, $2::jsonb)",
      [bid.bid_id, JSON.stringify(bid)]
    );

    await client.query("COMMIT");
    await refreshCache("bidders");
    await refreshCache("bids");
    return { bidder: updatedBidder, bid };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closeDatabase() { await pool.end(); }
