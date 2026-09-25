# ProcureShield AI

GeM-style bid verification and bidder-network analysis for procurement officers,
built on top of the **ProcureShield Engine** — a graph + graph-neural-network
risk engine for detecting bid-rigging patterns.

> **Risk, not verdict.** Nothing in this system determines that a company has
> done anything wrong. Every score is a *review priority* that requires
> independent human investigation. The engine refuses to emit verdict language,
> and a test asserts that no such term appears in its output.

---

## 1. Architecture

```
  React client (Vite, :5173)
        |  /api/*
        v
  Node BFF (Express, :4000)          <- auth, verification workflow, audit log,
        |  HTTP                         CSV/report shaping, demo dataset
        v
  ProcureShield Engine (FastAPI, :8000)
        |
        |-- identity normalisation -> heterogeneous graph (NetworkX)
        |-- 27 company features + Louvain communities
        |-- 10 company + 4 tender risk signals (explicit, explainable)
        |-- GAT (PyTorch Geometric) when labels exist
        +-- IsolationForest anomaly mode when they don't
```

**The Node server contains no risk logic.** Every score, signal, relationship,
cluster and explanation shown in the UI is computed by the Python engine. The
previous mock `riskEngine.js` and `aiEngine.js` have been deleted; what remains
in `server/utils/` is a translation layer:

| File | Role |
|------|------|
| `engineMapping.js` | Pure, unit-tested translation both directions (no network) |
| `engineClient.js` | The only place Node talks to the engine (cache, timeouts, recovery) |
| `registrySignals.js` | The two checks the engine genuinely cannot do (see section 5) |

---

## 2. Quick start

```bash
# one-time
npm install                       # root (concurrently)
npm run install:all               # client + server + engine deps

# run all three services
npm run dev
```

- Client: http://localhost:5173
- API: http://localhost:4000/api/health
- Engine docs: http://localhost:8000/docs
- Login: `admin` / `admin123`

Run pieces individually if you prefer:

```bash
npm run engine                 # FastAPI on :8000
npm run dev --prefix server    # Express on :4000
npm run dev --prefix client    # Vite on :5173
```

### Docker

The compose stack is self-contained: PostgreSQL, the Python engine, and the Node BFF.
The BFF waits for both PostgreSQL and the engine health checks before starting.

```bash
docker compose up --build
open http://localhost:4000     # client and API served from one origin
```

For the fastest CPU-only demo, the engine image installs the lightweight
rules/anomaly dependencies by default. Install `engine/requirements-full.txt`
locally only when you specifically need the PyTorch/PyG supervised GAT stack.

### Tests

```bash
npm test                  # 24 Node tests + 97 engine tests
npm run demo              # engine-only end-to-end demo on its own synthetic data
```

---

## 3. Demo dataset

The demo database is seeded into PostgreSQL on first startup. The bidder network
contains the current synthetic bidder set and dynamically calculated clusters;
cluster IDs are generated from the current analysis and should **not** be treated
as permanent demo identifiers.

For a presentation, open **Bidder Network Analysis** and select a currently
shown relationship group or search for a company by name/bidder ID. Selecting a
company shows its detected relationships and explicitly lists other companies
with **No detected relationship** when no computed link exists.

The relationship fields used by the demo are synthetic and are intended only to
exercise the investigation UI. They are not real-world findings about any
company.\n\n## 4. API

The client-facing API is unchanged in shape; its contents now come from the
engine. All routes except `/api/auth/login` and `/api/health` need
`Authorization: Bearer <token>` from login.

| Route | Notes |
|-------|-------|
| `POST /api/auth/login` | Demo credentials, static token |
| `GET /api/dashboard` | Stats, risk distribution, and which engine signals fired |
| `GET /api/bids` | Filter/sort/paginate; `risk_score` comes from the engine |
| `GET /api/bids/:id` | Bid + bidder + checklist + engine signals + tender context |
| `GET /api/bidders`, `/api/bidders/:id` | Includes the full engine profile |
| `GET /api/network` | Nodes, linkable edges, clusters with `signal_breakdown` |
| `GET /api/network/:bidderId` | Bidder projection plus the engine's own ego network |
| `GET /api/network/cluster/:id` | One cluster and its members |
| `GET /api/alerts?min_score=50` | One alert per cluster signal and per flagged bidder |
| `POST /api/verification/:bidId/{review,escalate,confirm,false-positive}` | Officer workflow -> audit log |
| `GET /api/audit-log` | Newest first |
| `POST /api/ai/analyze` | Looks up an engine explanation; generates no text itself |
| `GET /api/reports/:type[/csv]` | Four report types |
| `GET /api/engine/status` | Engine liveness, model state, thresholds |
| `POST /api/engine/refresh` | Re-run analysis (optionally training) |
| `POST /api/engine/train` | Train the GAT on the current graph |

Example:

```bash
TOKEN=$(curl -s -X POST localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | jq -r .token)

curl -s -H "Authorization: Bearer $TOKEN" localhost:4000/api/network | jq '.clusters[0]'
```

When the engine is down, analytics routes return **503** with the engine URL and
the command to start it, rather than rendering zeros as if they were findings.
Settings -> Analytics Engine shows the same state in the UI.

---

## 5. How the data is mapped

`server/utils/engineMapping.js` turns GeM-shaped records into engine records:

| GeM field | Engine field | Note |
|-----------|--------------|------|
| `bidder_id` | `company_id` | |
| `company_name` | `company_name` | Engine normalises and merges spelling variants |
| `director_name` | `person_id` / `person_name` | Slugged, so two firms sharing a director share a node |
| `address` | `address` | |
| `category` | `department_id` | |
| `bid_amount`, `submission_date` | same | |
| - | `result` | **Inferred**: lowest bid in a tender wins (L1 convention) |
| - | `tender_value` | **Not supplied.** Unknown in this dataset |
| `label` | `label` | Only when explicitly 0 or 1 |

Two decisions worth knowing about:

- **Winner inference.** The demo data records no award outcome, and
  `verification_status` is a workflow state, not an award. The lowest bid is
  taken as the winner. On real data, supply the actual result.
- **`tender_value` is never fabricated.** Signals that need it
  (`NO_PRICE_PRESSURE`) are reported by the engine as non-evaluable and excluded
  from the score denominator, rather than scored against a guess.

**Registry signals.** The engine's graph has no Phone or BankAccount node type,
so shared-phone and shared-bank-account matches are computed in
`server/utils/registrySignals.js` by exact string equality. They add evidence to
a relationship and can link bidders into a cluster; they never change a risk
score. Every score still comes from the engine.

---

## 6. Configuration

Use **`server/.env.example` as the single canonical environment template** and
copy it to `server/.env`. Docker Compose supplies the container-specific
PostgreSQL and engine values automatically; do not use a second root env file.

| Variable | Default | Meaning |
|----------|---------|---------|
| `ENGINE_URL` | `http://127.0.0.1:8000` | Use `127.0.0.1`, not `localhost` — Node resolves `localhost` to `::1` first while uvicorn binds IPv4 |
| `ENGINE_TRAIN` | `false` | Retrain on every analysis (slow) |
| `ENGINE_USE_MODEL` | `true` | `false` = deterministic graph rules only |
| `PROCURESHIELD_ALERT_THRESHOLD` | `50` | Score at/above which an entity is flagged |
| `PROCURESHIELD_RULE_WEIGHT` / `_MODEL_WEIGHT` | `0.6` / `0.4` | Blend of graph rules and GNN |
| `PROCURESHIELD_GRAPH_BACKEND` | `memory` | `neo4j` to persist the graph |

Engine internals (thresholds, model hyperparameters, risk bands) live in
`engine/backend/config.py`; see `engine/README.md`.

---

## 7. Database and dependency notes

PostgreSQL is the persistent application store. The local Docker stack creates
it automatically and passes `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/procureshield`
to the BFF. The Node server waits for the database to become healthy before
initialising tables and serving requests.

The engine's default `requirements.txt` is intentionally lightweight. The
optional `requirements-full.txt` adds PyTorch and PyTorch Geometric for
supervised GAT training. Rules-only mode does not require those heavy packages.

## 8. Changes made to the engine during integration

Three additions, all backwards compatible; the engine's 97 tests still pass.

1. **`include_all_entities`** on `POST /analyze` — returns every scored company,
   not just flagged ones. The UI renders a full portfolio, and the alternative
   (setting the alert threshold to 0) would have made the engine's own
   explanations report a threshold of zero.
2. **`GET /lookup/tender` and `/lookup/company`** — query-parameter forms of the
   existing path-based lookups. Real tender references like
   `GEM/2026/T/002001` contain slashes that split a path segment even when
   URL-encoded.
3. **Optional CORS**, off unless `PROCURESHIELD_CORS_ORIGINS` is set. The
   browser normally talks only to the BFF.

The BFF also re-posts the last analysis automatically if the engine restarts and
loses its in-memory graph, instead of surfacing a spurious "no analysis has been
run" error.

---

## 9. Known limits

- **Prototype auth.** A static bearer token, no expiry, no per-user sessions.
- **JSON files as a database.** Concurrent verification actions can race.
- **The engine holds one analysis in memory.** Fine for a single-officer demo;
  a real deployment needs per-request or persisted context.
- **Cluster alerts have no date.** They describe a standing pattern, not an
  event, so the UI shows them without one.
- **Synthetic data flatters the model.** Planted patterns are cleanly separable
  and labels are noise-free. Real procurement data is noisier, labels are scarce
  and partly wrong, and legitimate firms share directors and addresses for
  ordinary reasons — a shared address is often a business-centre suite, and
  specialist firms co-bid because only they qualify. Treat the metrics as a
  smoke test of the pipeline, not as validation of the method.
- **Disparate impact.** Small and regional firms co-bid more often simply
  because the eligible pool is small. Consider this before acting on scores.

The original pre-integration prototype README is kept at
`docs/README-original-prototype.md`.
