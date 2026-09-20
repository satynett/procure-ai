"""Feature engineering and network analysis tests."""

from __future__ import annotations

import numpy as np
import pytest

from backend.analysis.network_analysis import (
    analyse_cluster_behaviour,
    compute_centrality,
    dense_bidding_groups,
    detect_communities,
    normalised_entropy,
)
from backend.data.loader import records_from_dicts
from backend.data.normalize import normalize_records
from backend.features.graph_features import (
    COMPANY_FEATURE_COLUMNS,
    build_features,
    compute_tender_features,
)
from backend.graph.builder import build_graph


def test_feature_matrix_shape_and_order(bundle, graph):
    matrix, company_ids = bundle.matrix()
    assert matrix.shape == (len(graph.companies), len(COMPANY_FEATURE_COLUMNS))
    assert list(bundle.company_features.columns) == COMPANY_FEATURE_COLUMNS
    assert set(company_ids) == set(graph.companies)


def test_no_label_column_leaks_into_features(bundle):
    assert not any("label" in column.lower() for column in bundle.company_features.columns)


def test_features_are_finite(bundle):
    matrix, _ = bundle.matrix()
    assert np.isfinite(matrix).all()


def test_planted_rings_separate_from_clean_firms(bundle, graph):
    frame = bundle.company_features
    flagged = [c for c, v in graph.labels.items() if v == 1]
    clean = [c for c, v in graph.labels.items() if v == 0]
    assert flagged and clean

    # Cartel members co-bid with the same partners far more often...
    assert frame.loc[flagged, "top_partner_ratio"].mean() > (
        frame.loc[clean, "top_partner_ratio"].mean() + 0.2
    )
    # ...and price far closer to their repeat opponents.
    assert frame.loc[flagged, "min_pair_price_gap"].mean() < (
        frame.loc[clean, "min_pair_price_gap"].mean()
    )


def test_pair_features_cover_cobidders(bundle, graph):
    assert bundle.pair_features
    pair = bundle.pair_features[0]
    assert pair.shared_tenders >= 1
    assert pair.company_a in graph.companies
    payload = pair.to_dict()
    assert {"company_a", "company_b", "shared_tenders"} <= set(payload)


def test_tender_features_flag_single_bidder():
    rows = [
        {"company_id": "C1", "tender_id": "T1", "bid_amount": 100, "result": "WIN"},
        {"company_id": "C1", "tender_id": "T2", "bid_amount": 100, "result": "WIN"},
        {"company_id": "C2", "tender_id": "T2", "bid_amount": 105},
    ]
    valid, _ = records_from_dicts(rows)
    graph = build_graph(normalize_records(valid))
    frame = compute_tender_features(graph)
    assert bool(frame.loc["T_T1", "single_bidder"]) is True
    assert bool(frame.loc["T_T2", "single_bidder"]) is False
    assert frame.loc["T_T2", "n_bidders"] == 2


def test_communities_are_a_partition(graph):
    report = detect_communities(graph)
    assert set(report.membership) == set(graph.companies)
    total = sum(report.sizes.values())
    assert total == len(graph.companies)


def test_cluster_behaviour_reports_rotation(graph):
    report = detect_communities(graph)
    behaviour = analyse_cluster_behaviour(graph, report)
    assert behaviour
    for entry in behaviour.values():
        assert 0.0 <= entry.rotation_entropy <= 1.0
        assert 0.0 <= entry.capture_ratio <= 1.0


def test_centrality_covers_all_nodes(graph):
    scores = compute_centrality(graph)
    assert len(scores.degree) == graph.graph.number_of_nodes()
    row = scores.for_node(graph.companies[0])
    assert set(row) == {
        "degree_centrality", "weighted_degree", "betweenness",
        "pagerank", "eigenvector", "clustering_coefficient",
    }


@pytest.mark.parametrize(
    "counts,expected",
    [([5, 5, 5], 1.0), ([10, 0, 0], 0.0), ([], 0.0), ([7], 0.0)],
)
def test_normalised_entropy(counts, expected):
    assert normalised_entropy([c for c in counts if c > 0] or counts) == pytest.approx(
        expected, abs=1e-6
    )


def test_dense_groups_found_in_synthetic_data(graph):
    groups = dense_bidding_groups(graph, min_size=3, min_weight=3.0)
    assert groups, "expected at least one dense co-bidding clique"
    members, weight = groups[0]
    assert len(members) >= 3 and weight >= 3.0


def test_feature_pipeline_is_deterministic(graph):
    first = build_features(graph).company_features
    second = build_features(graph).company_features
    assert np.allclose(first.to_numpy(), second.to_numpy())
