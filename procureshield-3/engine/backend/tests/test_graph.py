"""Graph construction, schema enforcement and projections."""

from __future__ import annotations

import networkx as nx
import pytest

from backend.data.loader import records_from_dicts
from backend.data.normalize import normalize_records
from backend.exceptions import GraphBuildError
from backend.graph.builder import build_graph, ego_network, export_edges, export_nodes
from backend.graph.schema import EDGE_SCHEMA, EdgeType, NodeType
from backend.graph.store import InMemoryGraphStore, build_store


def _graph_from(rows):
    valid, _ = records_from_dicts(rows)
    return build_graph(normalize_records(valid))


def test_empty_dataset_rejected():
    valid, _ = records_from_dicts([{"company_id": "C1", "tender_id": "T1"}])
    dataset = normalize_records(valid)
    dataset.records = []
    with pytest.raises(GraphBuildError):
        build_graph(dataset)


def test_node_types_present(graph):
    for node_type in NodeType:
        assert graph.nodes_of_type(node_type), f"missing {node_type.value} nodes"


def test_every_edge_respects_schema(graph):
    for source, target, data in graph.graph.edges(data=True):
        edge_type = EdgeType(data["edge_type"])
        expected_source, expected_target = EDGE_SCHEMA[edge_type]
        assert graph.graph.nodes[source]["node_type"] == expected_source.value
        assert graph.graph.nodes[target]["node_type"] == expected_target.value


def test_winner_edges_match_results(graph):
    for tender, winner in graph.tender_winner.items():
        if winner is None:
            continue
        assert graph.graph.has_edge(winner, tender, key=EdgeType.WINS.value)


def test_cobid_edges_are_symmetric_pairs():
    rows = [
        {"company_id": "C1", "tender_id": "T1"},
        {"company_id": "C2", "tender_id": "T1"},
        {"company_id": "C1", "tender_id": "T2"},
        {"company_id": "C2", "tender_id": "T2"},
    ]
    graph = _graph_from(rows)
    cobid = [
        d for _, _, d in graph.graph.edges(data=True)
        if d["edge_type"] == EdgeType.CO_BID.value
    ]
    assert len(cobid) == 1
    assert cobid[0]["weight"] == 2.0
    assert len(cobid[0]["tenders"]) == 2


def test_ownership_is_derived_only_for_multi_company_officers():
    rows = [
        {"company_id": "C1", "person_id": "P1", "person_name": "Ann Lee", "tender_id": "T1"},
        {"company_id": "C2", "person_id": "P1", "person_name": "Ann Lee", "tender_id": "T2"},
        {"company_id": "C3", "person_id": "P2", "person_name": "Bo Sen", "tender_id": "T3"},
    ]
    graph = _graph_from(rows)
    owns = [
        (s, t) for s, t, d in graph.graph.edges(data=True)
        if d["edge_type"] == EdgeType.OWNS.value
    ]
    assert len(owns) == 2
    assert all(graph.graph.nodes[t]["node_type"] == NodeType.COMPANY.value for _, t in owns)


def test_duplicate_rows_keep_lowest_bid():
    rows = [
        {"company_id": "C1", "tender_id": "T1", "bid_amount": 100},
        {"company_id": "C1", "tender_id": "T1", "bid_amount": 90, "result": "WIN"},
    ]
    graph = _graph_from(rows)
    bid = graph.bids[(graph.companies[0], "T_T1")]
    assert bid["bid_amount"] == 90
    assert bid["is_winner"] is True


def test_projections_and_exports(graph):
    undirected = graph.undirected_projection()
    assert isinstance(undirected, nx.Graph)
    assert undirected.number_of_nodes() == graph.graph.number_of_nodes()

    projection = graph.company_projection()
    assert set(projection.nodes) == set(graph.companies)

    assert len(export_nodes(graph, limit=10)) == 10
    assert len(export_edges(graph, limit=10)) == 10


def test_ego_network_respects_depth(graph):
    company = graph.companies[0]
    near, _ = ego_network(graph, company, depth=1)
    far, _ = ego_network(graph, company, depth=2)
    assert len(near) <= len(far)
    assert all(n["hops"] <= 1 for n in near)
    assert ego_network(graph, "does-not-exist") == ([], [])


def test_store_roundtrip(graph, settings):
    store = build_store(settings)
    assert isinstance(store, InMemoryGraphStore)
    stats = store.persist(graph)
    assert stats["nodes"] == graph.graph.number_of_nodes()
    neighbours = store.fetch_neighbors(graph.companies[0], depth=1)
    assert neighbours["nodes"]
    store.close()
