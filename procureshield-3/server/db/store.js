import pg from "pg";
import { seedData } from "./seed.js";

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
}

export async function refreshCache(collection) {
  const result=await pool.query("SELECT data FROM " + TABLES[collection] + " ORDER BY updated_at DESC");
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
    await client.query("DELETE FROM " + table);
    for (const row of rows) {
      if (!row?.[key]) continue;
      await client.query(
        "INSERT INTO " + table + " (" + key + ", data) VALUES ($1, $2::jsonb)",
        [row[key], JSON.stringify(row)]
      );
    }
    await client.query("COMMIT");
    cache.set(collection,rows.map(row=>({...row})));
  } catch(err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closeDatabase() { await pool.end(); }
