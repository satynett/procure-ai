"""Model tests: leakage-free splits, metrics, determinism, fallbacks."""

from __future__ import annotations

import numpy as np
import pytest

from backend.config import ModelConfig
from backend.exceptions import ModelNotTrainedError
from backend.features.encoders import build_graph_tensors, scale_features
from backend.models.anomaly import score_anomalies
from backend.models.gat import PYG_AVAILABLE, TORCH_AVAILABLE, describe_backend
from backend.models.trainer import GATTrainer, SplitIndices, make_splits

pytestmark = pytest.mark.skipif(not TORCH_AVAILABLE, reason="PyTorch not installed")


@pytest.fixture(scope="module")
def tensors(graph, bundle):
    return build_graph_tensors(graph, bundle, graph.labels)


def test_tensor_shapes(tensors, graph):
    assert tensors.x.shape[0] == graph.graph.number_of_nodes()
    assert tensors.edge_index.shape[0] == 2
    # Edges are materialised in both directions for message passing.
    assert tensors.edge_index.shape[1] == 2 * graph.graph.number_of_edges()
    assert len(tensors.company_ids) == len(graph.companies)
    assert tensors.num_features == tensors.x.shape[1]


def test_splits_are_disjoint_and_stratified():
    labels = np.array([0] * 40 + [1] * 20)
    rows = list(range(60))
    splits = make_splits(labels, rows, ModelConfig(seed=1))
    splits.assert_disjoint()
    assert len(splits.train) + len(splits.val) + len(splits.test) == 60
    for part in (splits.train, splits.val, splits.test):
        assert labels[part].sum() > 0, "each split should contain positives"


def test_leakage_is_detected():
    bad = SplitIndices(train=[1, 2, 3], val=[3], test=[9])
    with pytest.raises(ValueError, match="leakage"):
        bad.assert_disjoint()


def test_scaler_fits_on_training_rows_only(tensors):
    import torch

    train_rows = list(range(10))
    scaled, scaler = scale_features(tensors.x, train_rows)
    assert scaled.shape == tensors.x.shape
    raw = tensors.x.numpy()[train_rows]
    assert np.allclose(scaler.mean_, raw.mean(axis=0), atol=1e-4)
    # Reusing the fitted scaler must not refit.
    again, _ = scale_features(tensors.x, [], scaler=scaler)
    assert torch.allclose(scaled, again)


def test_training_reports_all_required_metrics(tensors):
    result = GATTrainer(ModelConfig(epochs=60, seed=42)).train(tensors)
    assert result.trained and result.mode == "supervised_gat"
    for split in ("train", "validation", "test"):
        metrics = result.metrics[split]
        for key in ("precision", "recall", "f1", "roc_auc"):
            assert key in metrics
        assert 0.0 <= metrics["precision"] <= 1.0
        assert 0.0 <= metrics["recall"] <= 1.0
    # The planted patterns are strong, so the model should rank them well.
    assert result.metrics["test"]["roc_auc"] is None or result.metrics["test"]["roc_auc"] > 0.7


def test_training_is_reproducible(tensors):
    first = GATTrainer(ModelConfig(epochs=40, seed=11)).train(tensors)
    second = GATTrainer(ModelConfig(epochs=40, seed=11)).train(tensors)
    assert first.metrics["test"] == second.metrics["test"]
    shared = set(first.probabilities) & set(second.probabilities)
    assert shared
    assert all(
        abs(first.probabilities[k] - second.probabilities[k]) < 1e-6 for k in shared
    )


def test_predict_requires_training(tensors):
    with pytest.raises(ModelNotTrainedError):
        GATTrainer(ModelConfig()).predict(tensors)


def test_single_class_labels_rejected(graph, bundle):
    single = {company: 0 for company in graph.companies}
    tensors = build_graph_tensors(graph, bundle, single)
    with pytest.raises(ModelNotTrainedError):
        GATTrainer(ModelConfig(epochs=5)).train(tensors)


def test_save_and_load_roundtrip(tensors, tmp_path):
    trainer = GATTrainer(ModelConfig(epochs=30, seed=5))
    trained = trainer.train(tensors)
    trainer.save(tmp_path)

    restored = GATTrainer(ModelConfig(epochs=30, seed=5))
    restored.load(tmp_path, in_channels=tensors.num_features)
    probabilities = restored.predict(tensors)
    assert set(probabilities) == set(trained.probabilities)
    assert all(
        abs(probabilities[k] - trained.probabilities[k]) < 1e-5 for k in probabilities
    )


def test_anomaly_mode_scores_every_company(bundle):
    matrix, company_ids = bundle.matrix()
    result = score_anomalies(
        matrix, company_ids, list(bundle.company_features.columns), ModelConfig(seed=3)
    )
    assert set(result.scores) == set(company_ids)
    assert all(0.0 <= v <= 1.0 for v in result.scores.values())

    training = result.to_training_result(seed=3)
    assert training.mode == "unsupervised_anomaly"
    assert training.metrics == {}


def test_anomaly_ranks_planted_rings_above_clean_firms(bundle, graph):
    matrix, company_ids = bundle.matrix()
    scores = score_anomalies(
        matrix, company_ids, list(bundle.company_features.columns), ModelConfig(seed=3)
    ).scores
    flagged = [scores[c] for c, v in graph.labels.items() if v == 1]
    clean = [scores[c] for c, v in graph.labels.items() if v == 0]
    assert np.mean(flagged) > np.mean(clean)


def test_fallback_gat_layer_matches_expected_shapes():
    import torch

    from backend.models.gat import FallbackGATConv

    layer = FallbackGATConv(6, 4, heads=2)
    x = torch.randn(5, 6)
    edge_index = torch.tensor([[0, 1, 2, 3], [1, 2, 3, 4]], dtype=torch.long)
    out = layer(x, edge_index)
    assert out.shape == (5, 8)
    assert torch.isfinite(out).all()


def test_backend_description():
    described = describe_backend()
    assert described["torch_available"] is True
    assert described["gat_backend"] == (
        "torch_geometric" if PYG_AVAILABLE else "pytorch_fallback"
    )
