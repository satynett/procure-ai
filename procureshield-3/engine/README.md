# ProcureShield Engine

A production-shaped Python backend that scores **procurement bid-rigging and
collusion risk** by combining an explicit graph-signal rule engine with a Graph
Attention Network (GAT) over a heterogeneous procurement graph.

> **Risk, not verdict.** ProcureShield never labels a company fraudulent. It
> produces statistical *risk indicators* — "suspicious", "high-risk" — that
> require independent human investigation. A compliance guard rejects any
> generated explanation containing verdict language (`fraudulent`, `guilty`,
> `convicted`, `confirmed cartel`, …), and a unit test asserts that no such term
> appears anywhere in an `/analyze` response.

---

## 1. What it does

| Stage | Module | Output |
|-------|--------|--------|
| 1. Load + validate | `backend/data/loader.py`, `schema.py` | typed `BidRecord`s, rejected-row report |
| 2. Normalize identities | `backend/data/normalize.py` | canonical company / person / address ids |
| 3. Build hetero graph | `backend/graph/builder.py` | `nx.MultiDiGraph` + indexes |
| 4. Graph features | `backend/features/graph_features.py` | 27 company features |
| 5. Community / relationship analysis | `backend/analysis/network_analysis.py` | Louvain communities, centralities, cluster behaviour |
| 6. Tensor encoding | `backend/features/encoders.py` | PyG `Data` (node features, edge_index, edge_type) |
| 7. Supervised training | `backend/models/gat.py`, `trainer.py` | GAT + precision / recall / F1 / ROC-AUC |
| 8. Unsupervised fallback | `backend/models/anomaly.py` | IsolationForest risk percentiles |
| 9. Blended scoring | `backend/analysis/scoring.py` | 0–100 score + risk band |
| 10. Explanations | `backend/analysis/scoring.py` | per-signal reasons + recommended actions |

### Graph schema

**Nodes:** `Company`, `Person`, `Tender`, `Department`, `Address`
**Edges:** `DIRECTOR_OF`, `OWNS`, `BIDS_IN`, `WINS`, `REGISTERED_AT`, `ISSUED_BY`, `CO_BID`

### Risk signals (explicit, explainable)

Company-level: `SHARED_DIRECTORS`, `SHARED_ADDRESS`, `REPEATED_CO_BIDDING`,
`BID_PRICE_SIMILARITY`, `COVER_BID_PATTERN`, `WINNER_ROTATION`,
`MARKET_CONCENTRATION`, `HIGH_CENTRALITY`, `DENSE_SUBGROUP`,
`UNCONTESTED_AWARDS`.

Tender-level: `TIGHT_BID_CLUSTER`, `UNIFORM_LOSING_MARGINS`, `SINGLE_BIDDER`,
`NO_PRICE_PRESSURE`.

Signals that cannot be evaluated (e.g. no director data supplied) are marked
non-evaluable and are **excluded from the score denominator**, so a sparse
dataset does not silently deflate every score.

---

## 2. Project layout

```
backend/
  api/          FastAPI app, pydantic schemas, DI singletons
  analysis/     risk signals, scoring, network analysis, pipeline facade
  data/         schema, loader, identity normalization, synthetic generator
  features/     graph features + PyG tensor encoders
  graph/        node/edge schema, graph builder, memory & Neo4j stores
  models/       GAT, trainer, anomaly mode, model registry
  tests/        97 unit + API tests
run_demo.py     end-to-end CLI demo on synthetic data
Dockerfile      python:3.11-slim image serving uvicorn on :8000
```

---

## 3. Setup

```bash
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Optional: enable the supervised GAT / PyTorch stack when needed.
pip install -r requirements-full.txt

# optional: Neo4j driver for the persistent graph backend
pip install -r requirements-optional.txt
```

CPU-only PyTorch wheels from PyPI are sufficient. For CUDA, install torch from
the official index first, then `pip install -r requirements.txt`.

### Run the demo (no server needed)

```bash
python run_demo.py                  # synthetic data -> graph -> GAT -> scores
python run_demo.py --no-model       # deterministic rules-only mode (no torch needed)
python run_demo.py --csv demo.csv   # also write the dataset to CSV
```

### Run the API

```bash
uvicorn backend.main:app --reload
# interactive docs: http://127.0.0.1:8000/docs
```

### Run the tests

```bash
pytest          # 97 passed
```

### Docker

```bash
docker build -t procureshield:latest .
docker run --rm -p 8000:8000 procureshield:latest
curl localhost:8000/health
```

---

## 4. Input data

Accepted from inline JSON rows, a server-side `.csv`/`.json` path, or the
built-in synthetic generator. Column aliases (`vendor_id` → `company_id`,
`tender_ref` → `tender_id`, …) are resolved automatically.

| Field | Required | Notes |
|-------|----------|-------|
| `company_id` | yes | raw registration id; aliases are merged by normalization |
| `tender_id` | yes | |
| `company_name` | recommended | drives identity resolution |
| `person_id` / `person_name` | optional | enables `SHARED_DIRECTORS` |
| `address` | optional | enables `SHARED_ADDRESS` |
| `department_id` | optional | enables buyer-side concentration |
| `bid_amount`, `tender_value` | optional | enable all price signals |
| `bid_date` | optional | ordering / rotation |
| `result` | optional | `win`/`won`/`awarded` vs `loss`/`lost`/`rejected` |
| `label` | optional | `1` = known collusive (training only) |

Rows that fail validation are dropped and reported in `validation`; if *every*
row fails the request returns `400`.

---

## 5. API

All examples assume `http://localhost:8000`.

### `GET /health`

```bash
curl -s localhost:8000/health
```

```json
{
  "status": "ok",
  "version": "0.1.0",
  "graph_backend": "memory",
  "model": {"torch_available": true, "pyg_available": true,
            "gat_backend": "torch_geometric", "trained": true},
  "last_analysis": "analysis_0001",
  "thresholds": {"alert_threshold": 50.0, "rule_weight": 0.6, "model_weight": 0.4}
}
```

### `POST /analyze`

Exactly one data source: `records`, `file_path`, or `use_synthetic: true`.

```bash
curl -s -X POST localhost:8000/analyze \
  -H 'Content-Type: application/json' \
  -d '{"use_synthetic": true, "train": true, "max_entities": 10}'
```

With your own rows:

```bash
curl -s -X POST localhost:8000/analyze \
  -H 'Content-Type: application/json' \
  -d '{
        "records": [
          {"company_id":"C1","company_name":"Apex Infra Pvt Ltd","person_id":"P1",
           "tender_id":"T1","department_id":"D1","address":"12 M.G. Road",
           "bid_amount":5100000,"tender_value":5000000,
           "bid_date":"2024-03-01","result":"loss"},
          {"company_id":"C2","company_name":"Apex Works Private Limited","person_id":"P1",
           "tender_id":"T1","department_id":"D1","address":"12 MG Rd",
           "bid_amount":4900000,"tender_value":5000000,
           "bid_date":"2024-03-01","result":"win"}
        ],
        "use_model": false
      }'
```

From a file on the server:

```bash
curl -s -X POST localhost:8000/analyze \
  -H 'Content-Type: application/json' \
  -d '{"file_path": "demo.csv", "train": true}'
```

Response (abridged):

```json
{
  "analysis_id": "analysis_0001",
  "mode": "supervised_gat",
  "risk_score": 85.27,
  "risk_level": "CRITICAL",
  "model_probability": 0.9994,
  "suspicious_entities": [
    {
      "entity_id": "C_f954cd5490e5",
      "entity_type": "Company",
      "name": "Apex Engineers Constructions",
      "risk_score": 85.27,
      "risk_level": "CRITICAL",
      "risk_status": "high risk - priority review recommended",
      "rule_score": 0.7549,
      "model_probability": 0.9994,
      "explanation": "... 8 indicator(s) triggered ...",
      "recommended_actions": ["Pull corporate registry filings for the named officers."],
      "requires_human_investigation": true,
      "risk_signals": [
        {"code": "SHARED_DIRECTORS", "severity": 1.0, "weight": 1.0,
         "description": "Shares at least one director with 4 other bidding companies ...",
         "evidence": {"shared_director_peers": 4}, "related_entities": ["C_..."]}
      ],
      "aliases": ["C0048"]
    }
  ],
  "suspicious_relationships": [
    {"company_a": "C_04cc...", "company_b": "C_3a6d...",
     "relationship_risk": 1.0,
     "reasons": ["1 shared officer(s) on both companies",
                 "registered at the same normalised address"]}
  ],
  "risk_signals": [{"code": "SHARED_DIRECTORS",
                    "label": "Common officers across competing bidders",
                    "companies_flagged": 35, "mean_severity": 0.56}],
  "graph_nodes": [{"id": "C_f954cd5490e5", "type": "Company", "label": "...", "degree": 49}],
  "graph_edges": [{"source": "C_f954cd5490e5", "target": "T_T0100",
                   "type": "BIDS_IN", "weight": 1.0}],
  "graph_stats": {"nodes": 299, "edges": 1523, "edges_CO_BID": 551},
  "explanation": "Analysed 56 companies across 126 tenders ... no entity has been determined to have done anything wrong.",
  "training": {"mode": "supervised_gat", "metrics": {"test": {"f1": 1.0, "roc_auc": 1.0}}},
  "disclaimer": "ProcureShield produces statistical risk indicators only. ..."
}
```

### `POST /train`

```bash
# train on the graph from the last /analyze run
curl -s -X POST localhost:8000/train \
  -H 'Content-Type: application/json' \
  -d '{"reuse_last_analysis": true, "epochs": 200, "seed": 42}'

# or train on a fresh dataset
curl -s -X POST localhost:8000/train \
  -H 'Content-Type: application/json' \
  -d '{"use_synthetic": true}'
```

Returns split sizes, per-split precision/recall/F1/ROC-AUC/average precision,
confusion-matrix counts, the tuned decision threshold, best epoch and seed. If
the dataset has no labels (or only one class), the endpoint automatically
returns unsupervised anomaly results instead of failing.

### `GET /company/{id}`

```bash
curl -s localhost:8000/company/C_f954cd5490e5
curl -s localhost:8000/company/C0012        # raw id also resolves
```

Returns the entity's score, band, every triggered signal with evidence,
recommended investigative actions, aliases, peers and tender history.

### `GET /tender/{id}`

```bash
curl -s localhost:8000/tender/T0100
```

```json
{
  "tender_id": "T0100", "risk_score": 72.63, "risk_level": "HIGH",
  "department": "Directorate of Health Services",
  "winner": "Meridian Constructions Private Limited",
  "bidders": [
    {"company_id": "C_04cc10eb648b", "name": "Orion Systems Pvt Ltd",
     "bid_amount": 5633161.94, "is_winner": false, "company_risk_score": 81.96}
  ]
}
```

### `GET /network/{id}`

```bash
curl -s "localhost:8000/network/C_f954cd5490e5?depth=1"
```

Ego network around any node id (company, tender, person, address, department):
`graph_nodes`, `graph_edges`, `node_count`, `edge_count`.

### `GET /alerts`

```bash
curl -s "localhost:8000/alerts?min_score=70&limit=20&entity_type=all"
```

`entity_type` is `company` (default), `tender`, or `all`.

### Errors

| Status | Cause |
|--------|-------|
| 400 | validation failure / bad source / graph build error |
| 404 | unknown company or tender id |
| 409 | entity endpoint called before any `/analyze`; or model not trained |
| 503 | optional dependency missing (e.g. torch for supervised training) |

---

## 6. Configuration

Every threshold is a frozen dataclass in `backend/config.py`. Common knobs are
overridable by environment variable, and per-request for `/analyze`.

| Variable | Default | Meaning |
|----------|---------|---------|
| `PROCURESHIELD_GRAPH_BACKEND` | `memory` | `memory` (NetworkX) or `neo4j` |
| `PROCURESHIELD_NEO4J_URI` | `bolt://localhost:7687` | |
| `PROCURESHIELD_NEO4J_USER` / `_PASSWORD` | `neo4j` / — | |
| `PROCURESHIELD_ALERT_THRESHOLD` | `50` | score at/above which an entity is "suspicious" |
| `PROCURESHIELD_RULE_WEIGHT` | `0.6` | weight of explicit graph signals |
| `PROCURESHIELD_MODEL_WEIGHT` | `0.4` | weight of the GNN probability |
| `PROCURESHIELD_EPOCHS` | `200` | max training epochs |
| `PROCURESHIELD_SEED` | `42` | training seed |
| `PROCURESHIELD_ARTIFACT_DIR` | `artifacts` | model weights, scaler, manifest |
| `PROCURESHIELD_LOG_LEVEL` | `INFO` | |

Risk bands: `LOW` ≤ 25 < `MEDIUM` ≤ 50 < `HIGH` ≤ 75 < `CRITICAL`.

### Graph backend

`memory` keeps everything in NetworkX — zero external services, used by the
demo, the tests and the default Docker image. Setting `neo4j` persists the same
nodes and relationships via parameterised Cypher `MERGE` statements; if the
driver or server is unavailable the store logs a warning and falls back to
memory rather than crashing the request. Analysis always runs on the NetworkX
projection, so results are identical either way.

---

## 7. Modelling details

**Encoding.** The heterogeneous graph is encoded homogeneously: each node gets a
5-dim node-type one-hot concatenated with the 27 company features (zeros for
non-company nodes), edges are emitted in both directions with an `edge_type` id.

**GAT.** Two `GATConv` layers (64 hidden, 4 heads, dropout 0.3) + LayerNorm + a
linear head. If PyTorch Geometric is missing, a `FallbackGATConv` implements
multi-head attention with self-loops and segment softmax using plain torch ops,
so the model still runs.

**Leakage controls.**
- Splits are over *companies*, stratified, and `SplitIndices.assert_disjoint()`
  verifies train/val/test share no index.
- The `StandardScaler` is fit on **training rows only**, then applied to all.
- Loss and metrics are masked to the relevant split; unlabelled nodes still
  participate in message passing (standard transductive setting) but never
  contribute to the loss or to any reported metric.
- Model selection uses the validation split only — early stopping on
  `(validation ROC-AUC, −validation loss)` with patience 30 — and the decision
  threshold is tuned on validation, never on test.

**Reproducibility.** `seed_everything(seed)` seeds `random`, `numpy`, `torch`
and `PYTHONHASHSEED`; the same seed and dataset reproduce the same metrics. Each
training run writes `artifacts/manifest.json` with the seed, feature names,
threshold and metrics alongside the weights and the fitted scaler.

**Unsupervised mode.** With no labels (or one class only), an IsolationForest
over the same feature matrix produces rank-percentile risk, blended with a
directional prior over risk-oriented features so the output is interpretable in
the same 0–100 space.

**Blending.** `score = 100 × (rule_weight × rule_score + model_weight × p_model)`,
renormalised when only one component is available.

---

## 8. Synthetic dataset

`backend/data/synthetic.py` generates a reproducible market: 40 independent
firms plus 4 cartels of 4 members, 90 competitive tenders and 9 tenders per
cartel. Planted patterns include shared directors, shared registered addresses,
win rotation, cover bids at 2.5–7.5 % above the winner, and alias registrations
with messy spellings (`A.B.C. INFRA PRIVATE LIMITED` ≡ `ABC Infra Pvt. Ltd.`).
15 % of cartel labels are withheld so you can watch the model recover members it
was never told about.

Default run: 532 rows → 56 canonical companies (from 64 raw ids, 8 merged),
126 tenders, 299 graph nodes, 1 523 edges, 6 Louvain communities
(modularity 0.337).

> **On the metrics.** The bundled run reports precision/recall/F1/ROC-AUC of
> 1.0 on train, validation and test. That is a property of a deliberately clean
> generator with strongly separable planted patterns — it is **not** an estimate
> of real-world performance. Real procurement data is noisier, labels are scarce
> and partly wrong, and legitimate firms share directors and addresses for
> ordinary reasons. Treat the synthetic numbers as a smoke test of the pipeline,
> not as validation of the method.

---

## 9. Responsible use

- Scores are indicators of *patterns*, not findings of misconduct. Each signal
  has innocent explanations (a genuine market leader looks central; specialist
  firms bid together because only they qualify; a shared address can be a
  business-centre suite).
- Nothing here substitutes for procurement audit, registry verification, or
  legal process. `requires_human_investigation` is set on every flagged entity
  by design.
- Consider disparate impact before acting on scores: small or regional firms
  co-bid more often simply because the eligible pool is small.
