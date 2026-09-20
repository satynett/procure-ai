"""API contract tests against the documented response shapes."""

from __future__ import annotations

import json
import re

import pytest
from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.api.dependencies import reset_pipeline
from backend.config import PROHIBITED_VERDICT_TERMS, Settings
from backend.data.synthetic import SyntheticConfig, generate_synthetic_dataset

REQUIRED_ANALYZE_FIELDS = {
    "risk_score",
    "risk_level",
    "suspicious_entities",
    "suspicious_relationships",
    "risk_signals",
    "graph_nodes",
    "graph_edges",
    "model_probability",
    "explanation",
}


@pytest.fixture(scope="module")
def client():
    settings = Settings()
    reset_pipeline(settings)
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def analyzed(client):
    """One trained analysis, reused by the response-contract tests."""
    response = client.post("/analyze", json={"use_synthetic": True, "train": True})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def current(client):
    """Re-run the analysis so cached-context endpoints see the full dataset.

    The pipeline deliberately keeps only the most recent analysis, so any test
    that calls /company, /tender, /network, /alerts or /train?reuse must
    establish that context itself.
    """
    response = client.post("/analyze", json={"use_synthetic": True})
    assert response.status_code == 200, response.text
    return response.json()


def test_health(client):
    payload = client.get("/health").json()
    assert payload["status"] == "ok"
    assert "gat_backend" in payload["model"]
    assert payload["disclaimer"]


def test_analyze_contract(analyzed):
    assert REQUIRED_ANALYZE_FIELDS <= set(analyzed)
    assert 0 <= analyzed["risk_score"] <= 100
    assert analyzed["risk_level"] in ("LOW", "MEDIUM", "HIGH", "CRITICAL")
    assert analyzed["graph_nodes"] and analyzed["graph_edges"]
    assert analyzed["mode"] == "supervised_gat"
    assert analyzed["training"]["metrics"]["test"]["f1"] >= 0.0


def test_suspicious_entities_are_explainable(analyzed):
    assert analyzed["suspicious_entities"], "synthetic data should raise alerts"
    for entity in analyzed["suspicious_entities"]:
        assert entity["risk_signals"], "every flagged entity needs at least one reason"
        assert entity["explanation"]
        assert entity["requires_human_investigation"] is True
        assert entity["recommended_actions"]
        for signal in entity["risk_signals"]:
            assert signal["description"] and signal["code"]


def test_no_verdict_language_anywhere_in_response(analyzed):
    blob = json.dumps(analyzed).lower()
    for term in PROHIBITED_VERDICT_TERMS:
        assert not re.search(rf"\b{re.escape(term)}\b", blob), f"found {term!r}"
    assert "fraud" not in blob.replace("anti-fraud", "")


def test_analyze_with_inline_records(client):
    frame = generate_synthetic_dataset(
        SyntheticConfig(seed=5, n_clean_companies=8, n_cartels=1, cartel_size=3,
                        n_competitive_tenders=10, n_cartel_tenders_each=5)
    )
    rows = json.loads(frame.to_json(orient="records"))
    response = client.post("/analyze", json={"records": rows, "use_model": False})
    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "rules_only"
    assert payload["model_probability"] is None


def test_analyze_rejects_bad_payloads(client):
    assert client.post("/analyze", json={}).status_code == 422
    assert client.post(
        "/analyze", json={"use_synthetic": True, "file_path": "x.csv"}
    ).status_code == 422
    bad = client.post("/analyze", json={"records": [{"tender_id": "T1"}]})
    assert bad.status_code == 400
    assert bad.json()["error"] == "invalid_data"


def test_analyze_from_file(client, tmp_path):
    path = tmp_path / "bids.csv"
    generate_synthetic_dataset(
        SyntheticConfig(seed=9, n_clean_companies=6, n_cartels=1, cartel_size=3,
                        n_competitive_tenders=8, n_cartel_tenders_each=4)
    ).to_csv(path, index=False)
    response = client.post("/analyze", json={"file_path": str(path)})
    assert response.status_code == 200
    assert response.json()["dataset_summary"]["companies"] > 0


def test_missing_file_returns_400(client):
    response = client.post("/analyze", json={"file_path": "/nope/missing.csv"})
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_data"


def test_company_endpoint(client, current):
    entity = current["suspicious_entities"][0]
    payload = client.get(f"/company/{entity['entity_id']}").json()
    assert payload["entity_id"] == entity["entity_id"]
    assert payload["tenders_entered"] > 0
    assert payload["features"]
    assert payload["disclaimer"]
    # Lookup by display name also works.
    by_name = client.get(f"/company/{entity['name']}")
    assert by_name.status_code == 200


def test_company_not_found(client, current):
    response = client.get("/company/definitely-not-a-company")
    assert response.status_code == 404
    assert response.json()["error"] == "not_found"


def test_tender_endpoint(client, current):
    tender_id = next(
        node["label"] for node in current["graph_nodes"] if node["type"] == "Tender"
    )
    payload = client.get(f"/tender/{tender_id}").json()
    assert payload["tender_id"] == tender_id
    assert 0 <= payload["risk_score"] <= 100
    assert isinstance(payload["bidders"], list)
    assert client.get("/tender/T-nope").status_code == 404


def test_network_endpoint(client, current):
    entity = current["suspicious_entities"][0]
    payload = client.get(f"/network/{entity['entity_id']}", params={"depth": 1}).json()
    assert payload["center"] == entity["entity_id"]
    assert payload["node_count"] == len(payload["graph_nodes"])
    assert any("risk_score" in node for node in payload["graph_nodes"])
    assert client.get(f"/network/{entity['entity_id']}", params={"depth": 9}).status_code == 422


def test_alerts_endpoint(client, current):
    payload = client.get("/alerts", params={"min_score": 50, "limit": 5}).json()
    assert payload["threshold"] == 50
    assert len(payload["alerts"]) <= 5
    scores = [alert["risk_score"] for alert in payload["alerts"]]
    assert scores == sorted(scores, reverse=True)
    assert all(score >= 50 for score in scores)

    everything = client.get("/alerts", params={"min_score": 0, "entity_type": "all"}).json()
    assert everything["count"] >= payload["count"]


def test_train_endpoint_reusing_last_analysis(client, current):
    payload = client.post(
        "/train", json={"reuse_last_analysis": True, "epochs": 20, "seed": 7}
    ).json()
    assert payload["trained"] is True
    assert payload["split_sizes"]["train"] > 0
    for metric in ("precision", "recall", "f1", "roc_auc"):
        assert metric in payload["metrics"]["test"]


def test_train_falls_back_to_unsupervised_without_labels(client):
    frame = generate_synthetic_dataset(
        SyntheticConfig(seed=4, n_clean_companies=8, n_cartels=1, cartel_size=3,
                        n_competitive_tenders=10, n_cartel_tenders_each=5,
                        include_labels=False)
    )
    rows = json.loads(frame.to_json(orient="records"))
    payload = client.post("/train", json={"records": rows}).json()
    assert payload["mode"] == "unsupervised_anomaly"
    assert payload["metrics"] == {}
    assert "labels" in payload["message"].lower()


def test_endpoints_require_prior_analysis():
    reset_pipeline(Settings())
    with TestClient(create_app(Settings())) as fresh:
        for url in ("/company/C1", "/tender/T1", "/network/C1", "/alerts"):
            response = fresh.get(url)
            assert response.status_code == 404
            assert "analy" in response.json()["detail"].lower()
    reset_pipeline(Settings())


def test_demo_dataset_endpoint(client):
    payload = client.get("/demo/dataset", params={"rows": 3}).json()
    assert len(payload["rows"]) == 3
    assert "company_id" in payload["columns"]


def test_openapi_documents_all_endpoints(client):
    paths = client.get("/openapi.json").json()["paths"]
    for route in ("/analyze", "/train", "/alerts", "/health",
                  "/company/{company_id}", "/tender/{tender_id}",
                  "/network/{entity_id}"):
        assert route in paths
