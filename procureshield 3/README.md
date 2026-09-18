# ProcureShield AI
### GeM Bid Verification & Network Risk Analysis — Smart India Hackathon Prototype

> ⚠️ **DEMO / SANDBOX DATA.** This is a working prototype built for hackathon
> demonstration. It uses realistic **synthetic** bidder and bid data and is
> **not connected to any live GeM government API** or production database.
> All relationship-risk scores are a *review priority signal*, never proof
> of wrongdoing — every workflow ends with a human procurement officer
> making the final decision.

---

## Recent enhancements

- **Server-side auth enforcement.** The API itself now requires the demo
  bearer token on every route (previously only the React router gated
  access, so the API would answer any unauthenticated curl request).
- **Login rate limiting** (10 attempts/min/IP) to blunt naive brute-forcing.
- **Pagination & sorting** on `GET /api/bids` (`page`, `pageSize`, `sortBy`,
  `sortDir`) — fully backward compatible, opt-in only.
- **CSV export** for bids (with current filters) and for the two tabular
  reports, both from the API and as buttons in the UI.
- **Cleaner PDF reports** — the "Download PDF" report now renders an actual
  table (via `jspdf-autotable`) instead of a dump of raw JSON text, and the
  in-app report preview is a readable table too.
- **Centralized error handling & input validation** — invalid verification
  actions, oversize comments, and unknown API routes now return clean JSON
  errors instead of crashing or 500-ing silently.
- **Unit tests** for the risk-scoring engine and compliance checklist
  (`cd server && npm test`), covering the scoring rules, the "weak signals
  never cluster on their own" guarantee, and PII masking.

## 1. What this is

ProcureShield AI helps a GeM procurement officer:

1. Run an **automated compliance checklist** on a submitted bid (GST/PAN format, MSME info, bank details, director info, address, documents).
2. See an **AI Verification Assistant** panel that explains findings in plain language — always evidence-based, never accusatory.
3. Explore a **Bidder Network Analysis** graph that visualizes director/address/phone/bank relationships between bidders.
4. Review an **explainable relationship-risk score** (0–100) with a full weight breakdown.
5. Take a **human-in-the-loop decision** — Confirm & Close, Send for Manual Review, Mark as False Positive, or Escalate — every action is written to an audit log.

## 2. Tech stack

- **Frontend:** React 18 + Vite, Tailwind CSS, lucide-react icons, Recharts, React Flow
- **Backend:** Node.js + Express, JSON-file "database" (`server/data/*.json`)
- **AI layer:** `/api/ai/analyze` — deterministic mock engine by default; optionally calls a real Anthropic model if `ANTHROPIC_API_KEY` is set

## 3. Running it

```bash
npm install     # installs root, server, and client dependencies
npm run dev     # starts backend (port 4000) and frontend (port 5173) together
```

Then open **http://localhost:5173**.

Demo login: **admin / admin123**

If you ever want to reset the sandbox dataset (e.g. after clicking several
"Send for Manual Review" actions) run:

```bash
cd server && node gen-data.js
```

This regenerates `bidders.json`, `bids.json`, and clears `auditLog.json`.

### Optional: enabling a real LLM

Copy `.env.example` to `server/.env` and set `ANTHROPIC_API_KEY`. Without
it, the app runs fully offline using the deterministic mock AI engine —
nothing is disabled or degraded for the demo.

## 4. Suggested 3–5 minute demo flow

1. **Dashboard** — show the stat cards and charts, then click **"Load Demo Scenario."**
2. It jumps to **Bidder Network Analysis** and opens the flagship cluster
   (`CLU-01`: Sharma Enterprises, S.K. Solutions, Reliable Traders, Alpha
   Enterprises, Beta Solutions, Gamma Traders — all sharing a director and
   a near-identical address).
3. Click a bidder node → side panel shows masked bank/phone details and a
   **"Investigate Cluster"** button → AI investigation summary streams in.
4. Go to **Bid Verification**, open a bid from that cluster (e.g. search
   "Sharma") → **Bid Detail** page: automated checklist, AI Verification
   Assistant panel, and the explainable risk-score modal (click the risk badge).
5. Choose **"Send for Manual Review"**, add a comment, confirm.
6. Go to **Reports → Audit Log** tab — the action is there with officer,
   timestamps, and previous/new status.
7. Optionally generate a **PDF report** from the Reports page, or use the
   **CSV** button (on Bid Verification or on the Bid/Risk reports) to export
   the current data as a spreadsheet-ready file.

## 5. How the risk score works

Every pairwise bidder comparison checks for:

| Signal | Weight |
|---|---|
| Shared Director | +30 |
| Shared Address (similarity-matched) | +20 |
| Shared Phone | +15 |
| Shared Bank Account | +35 |
| Similar GST/PAN pattern | +10 |
| Similar bidding behaviour | +10 |

Scores are clamped 0–100. Only the four "strong" signals (director,
address, phone, bank) are allowed to *group* bidders into a suspicious
network — this deliberately avoids false-positive clustering from weak,
coincidental signals like GST-state-code overlap. Categories:
0–30 Low · 31–60 Medium · 61–80 High · 81–100 Critical.

**This score represents "Relationship Risk / Review Priority," not proof
of fraud, cartel activity, or collusion.** The system never auto-rejects
a bidder — every flagged relationship requires manual officer review.

## 6. API surface

All routes below **except** `/api/auth/login` and `/api/health` now require
`Authorization: Bearer <token>` (the token returned by `/api/auth/login`).
Previously auth was enforced only by the React router — the API itself would
respond to any unauthenticated request. The frontend handles this
automatically; if you call the API directly (curl/Postman), log in first and
pass the returned token.

```
POST /api/auth/login                    (rate-limited: 10 attempts / min / IP)
GET  /api/health                        (public)
GET  /api/dashboard
GET  /api/bids                          (?q, status, risk, category, from, to, sortBy, sortDir, page, pageSize)
GET  /api/bids/export.csv               (same filters as above, always returns the full matching set)
GET  /api/bids/:id
GET  /api/bidders
GET  /api/bidders/:id
GET  /api/network                       (full graph + clusters)
GET  /api/network/:bidderId             (ego-graph for one bidder)
GET  /api/network/cluster/:clusterId
GET  /api/alerts
POST /api/verification/:bidId/review
POST /api/verification/:bidId/false-positive
POST /api/verification/:bidId/escalate
POST /api/verification/:bidId/confirm
GET  /api/audit-log
POST /api/ai/analyze                    ({ mode: "relationship" | "checklist" | "investigation_summary", payload })
GET  /api/reports/:type                 (bid-verification | bidder-network | risk-analysis | investigation-summary)
GET  /api/reports/:type/csv             (bid-verification | risk-analysis only — the other two are cluster-shaped, not row-shaped)
```

`GET /api/bids` is backward compatible: omit `page`/`pageSize` to get the
full filtered/sorted list as before, or pass them to page through results
(`pageSize` capped at 200). `sortBy` accepts `submission_date` (default),
`risk_score`, `bidder_name`, or `bid_id`; `sortDir` is `asc` or `desc`
(default `desc`).

### Running the backend test suite

```bash
cd server && npm test
```

Runs Node's built-in test runner (`node --test`) against
`server/tests/*.test.js`, covering the risk-scoring engine (signal
detection, score clamping, cluster formation, the "weak signals never
cluster on their own" rule, masking helpers) and the compliance checklist
builder (valid/invalid GST & PAN, evidence-based warnings, confidence
scores). No extra dependencies required.

## 7. Project structure

```
procureshield/
├── server/
│   ├── index.js            # Express app + all routes
│   ├── gen-data.js         # synthetic data generator (run to reset demo data)
│   ├── middleware/
│   │   ├── auth.js         # bearer-token check (protects the API itself, not just the UI)
│   │   └── rateLimit.js    # in-memory rate limiter for the login route
│   ├── utils/
│   │   ├── riskEngine.js   # relationship detection & scoring
│   │   ├── checklist.js    # automated compliance checklist logic
│   │   ├── aiEngine.js     # AI abstraction layer (mock + optional live LLM)
│   │   └── csv.js          # dependency-free CSV serializer for exports
│   ├── tests/              # node:test unit tests (riskEngine, checklist)
│   └── data/                # bidders.json, bids.json, auditLog.json
├── client/
│   └── src/
│       ├── pages/          # Landing, Login, Dashboard, BidVerification, BidDetail,
│       │                     BidderNetwork, RiskAnalysis, Alerts, Reports, Settings
│       └── components/     # Layout, Badges, Modal
└── .env.example
```

## 8. Notes for production evolution

This prototype is intentionally modular so a real deployment could later
swap in: authorized GeM APIs, a production database, a graph database for
relationship storage, and a hardened auth layer — without changing the
frontend contract. See the **Settings** page in-app for the full
prototype-vs-production architecture diagram.

Production deployment would require authorized government API access,
security controls, data governance, authentication, scalability
infrastructure, and validation with official procurement workflows. None
of these integrations currently exist in this prototype.
