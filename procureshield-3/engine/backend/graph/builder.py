"""Construction of the heterogeneous procurement graph in NetworkX."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from itertools import combinations
from typing import Dict, Iterable, List, Optional, Set, Tuple

import networkx as nx

from ..data.normalize import NormalizedDataset
from ..exceptions import GraphBuildError
from ..logging_utils import get_logger
from .schema import EDGE_SCHEMA, EdgeType, NodeType

LOGGER = get_logger("graph.builder")

#: Heuristic: a person listed as director on a company that also shares its
#: registered address with that person's other companies is treated as an owner
#: link too. Ownership columns are rarely present in open procurement feeds, so
#: OWNS is derived conservatively (see ``_derive_ownership``).
OWNERSHIP_MIN_COMPANIES = 2


@dataclass
class ProcurementGraph:
    """A heterogeneous procurement graph plus fast lookup indexes."""

    graph: nx.MultiDiGraph
    company_tenders: Dict[str, Set[str]] = field(default_factory=dict)
    tender_companies: Dict[str, Set[str]] = field(default_factory=dict)
    tender_winner: Dict[str, Optional[str]] = field(default_factory=dict)
    tender_department: Dict[str, Optional[str]] = field(default_factory=dict)
    company_persons: Dict[str, Set[str]] = field(default_factory=dict)
    company_addresses: Dict[str, Set[str]] = field(default_factory=dict)
    bids: Dict[Tuple[str, str], Dict[str, object]] = field(default_factory=dict)
    company_tender_documents: Dict[Tuple[str, str], Set[str]] = field(default_factory=dict)
    labels: Dict[str, int] = field(default_factory=dict)

    # ------------------------------------------------------------- accessors
    def nodes_of_type(self, node_type: NodeType) -> List[str]:
        return [
            n for n, data in self.graph.nodes(data=True)
            if data.get("node_type") == node_type.value
        ]

    @property
    def companies(self) -> List[str]:
        return self.nodes_of_type(NodeType.COMPANY)

    @property
    def tenders(self) -> List[str]:
        return self.nodes_of_type(NodeType.TENDER)

    def node_display(self, node_id: str) -> str:
        return str(self.graph.nodes.get(node_id, {}).get("display", node_id))

    def has_node(self, node_id: str) -> bool:
        return self.graph.has_node(node_id)

    def undirected_projection(self) -> nx.Graph:
        """Weighted simple graph used for centrality and community detection."""
        simple = nx.Graph()
        for node, data in self.graph.nodes(data=True):
            simple.add_node(node, **data)
        for source, target, data in self.graph.edges(data=True):
            weight = float(data.get("weight", 1.0))
            if simple.has_edge(source, target):
                simple[source][target]["weight"] += weight
            else:
                simple.add_edge(source, target, weight=weight,
                                edge_type=data.get("edge_type"))
        return simple

    def company_projection(self) -> nx.Graph:
        """Company-to-company graph (co-bidding, shared people, shared address)."""
        projection = nx.Graph()
        projection.add_nodes_from(self.companies)
        for source, target, data in self.graph.edges(data=True):
            if data.get("edge_type") != EdgeType.CO_BID.value:
                continue
            weight = float(data.get("weight", 1.0))
            if projection.has_edge(source, target):
                projection[source][target]["weight"] = max(
                    projection[source][target]["weight"], weight
                )
            else:
                projection.add_edge(source, target, weight=weight)

        # Structural links reinforce the projection so communities capture both
        # behavioural (co-bidding) and structural (shared officer/address) ties.
        for by_person in _invert(self.company_persons).values():
            for a, b in combinations(sorted(by_person), 2):
                weight = projection.get_edge_data(a, b, {}).get("weight", 0.0)
                projection.add_edge(a, b, weight=weight + 2.0)
        for by_address in _invert(self.company_addresses).values():
            for a, b in combinations(sorted(by_address), 2):
                weight = projection.get_edge_data(a, b, {}).get("weight", 0.0)
                projection.add_edge(a, b, weight=weight + 1.5)
        return projection

    def stats(self) -> Dict[str, int]:
        counts = defaultdict(int)
        for _, data in self.graph.nodes(data=True):
            counts[str(data.get("node_type"))] += 1
        edge_counts: Dict[str, int] = defaultdict(int)
        for _, _, data in self.graph.edges(data=True):
            edge_counts[str(data.get("edge_type"))] += 1
        return {
            "nodes": self.graph.number_of_nodes(),
            "edges": self.graph.number_of_edges(),
            **{f"nodes_{k}": v for k, v in counts.items()},
            **{f"edges_{k}": v for k, v in edge_counts.items()},
        }


def _invert(mapping: Dict[str, Set[str]]) -> Dict[str, Set[str]]:
    """company -> {attr} becomes attr -> {company}, keeping only shared attrs."""
    inverted: Dict[str, Set[str]] = defaultdict(set)
    for company, attributes in mapping.items():
        for attribute in attributes:
            inverted[attribute].add(company)
    return {k: v for k, v in inverted.items() if len(v) > 1}


def _add_node(
    graph: nx.MultiDiGraph, node_id: str, node_type: NodeType, display: str, **attrs
) -> None:
    if graph.has_node(node_id):
        graph.nodes[node_id].update({k: v for k, v in attrs.items() if v is not None})
        return
    graph.add_node(node_id, node_type=node_type.value, display=display, **attrs)


def _add_edge(
    graph: nx.MultiDiGraph,
    source: str,
    target: str,
    edge_type: EdgeType,
    **attrs,
) -> None:
    expected = EDGE_SCHEMA[edge_type]
    src_type = graph.nodes[source]["node_type"]
    dst_type = graph.nodes[target]["node_type"]
    if (src_type, dst_type) != (expected[0].value, expected[1].value):
        raise GraphBuildError(
            f"{edge_type.value} expects {expected[0].value}->{expected[1].value}, "
            f"got {src_type}->{dst_type}"
        )
    graph.add_edge(source, target, key=edge_type.value, edge_type=edge_type.value, **attrs)


def _derive_ownership(company_persons: Dict[str, Set[str]]) -> List[Tuple[str, str]]:
    """Flag person->company links where the person sits across several bidders.

    Real ownership registers are not part of the standard bid feed, so OWNS is
    derived as a *structural control* hypothesis, not a legal claim: a person
    holding directorships in two or more bidding companies is modelled as
    exercising control over each of them.
    """
    person_companies: Dict[str, Set[str]] = defaultdict(set)
    for company, persons in company_persons.items():
        for person in persons:
            person_companies[person].add(company)
    return [
        (person, company)
        for person, companies in person_companies.items()
        if len(companies) >= OWNERSHIP_MIN_COMPANIES
        for company in companies
    ]


def build_graph(dataset: NormalizedDataset) -> ProcurementGraph:
    """Build the heterogeneous graph from normalised records."""
    if not dataset.records:
        raise GraphBuildError("Cannot build a graph from an empty dataset.")

    graph = nx.MultiDiGraph()
    company_tenders: Dict[str, Set[str]] = defaultdict(set)
    tender_companies: Dict[str, Set[str]] = defaultdict(set)
    tender_winner: Dict[str, Optional[str]] = {}
    tender_department: Dict[str, Optional[str]] = {}
    company_persons: Dict[str, Set[str]] = defaultdict(set)
    company_addresses: Dict[str, Set[str]] = defaultdict(set)
    bids: Dict[Tuple[str, str], Dict[str, object]] = {}
    company_tender_documents: Dict[Tuple[str, str], Set[str]] = {}
    labels: Dict[str, int] = {}

    for record in dataset.records:
        company_id = dataset.companies.resolve(record.company_id)
        tender_id = f"T_{record.tender_id}"

        _add_node(
            graph,
            company_id,
            NodeType.COMPANY,
            dataset.companies.display(company_id),
            aliases=dataset.companies.aliases(company_id),
        )
        _add_node(graph, tender_id, NodeType.TENDER, record.tender_id,
                  tender_value=record.tender_value)

        company_tenders[company_id].add(tender_id)
        tender_companies[tender_id].add(company_id)
        tender_winner.setdefault(tender_id, None)
        tender_department.setdefault(tender_id, None)

        # ---------------------------------------------------------- bid edge
        key = (company_id, tender_id)
        existing = bids.get(key)
        bid_amount = record.bid_amount
        raw_document_hashes = record.model_extra.get("document_hashes", []) if hasattr(record, "model_extra") else []
        document_hashes = {str(x).strip().lower() for x in raw_document_hashes if str(x).strip()}
        if document_hashes:
            company_tender_documents.setdefault(key, set()).update(document_hashes)
        if existing is None:
            bids[key] = {
                "bid_amount": bid_amount,
                "tender_value": record.tender_value,
                "bid_date": record.bid_date.isoformat() if record.bid_date else None,
                "result": record.result,
                "is_winner": record.is_winner,
            }
            _add_edge(
                graph, company_id, tender_id, EdgeType.BIDS_IN,
                bid_amount=bid_amount,
                bid_date=bids[key]["bid_date"],
                result=record.result,
            )
        else:
            # Duplicate row for the same (company, tender): keep the lowest bid
            # and preserve any win flag.
            if bid_amount is not None and (
                existing["bid_amount"] is None or bid_amount < float(existing["bid_amount"])  # type: ignore[arg-type]
            ):
                existing["bid_amount"] = bid_amount
            existing["is_winner"] = bool(existing["is_winner"]) or record.is_winner

        if record.is_winner:
            tender_winner[tender_id] = company_id
            if not graph.has_edge(company_id, tender_id, key=EdgeType.WINS.value):
                _add_edge(graph, company_id, tender_id, EdgeType.WINS,
                          bid_amount=bid_amount)

        # ------------------------------------------------------- person edges
        if record.person_id or record.person_name:
            person_id = dataset.persons.resolve(record.person_id or "")
            if person_id and person_id.startswith("P"):
                _add_node(graph, person_id, NodeType.PERSON,
                          dataset.persons.display(person_id))
                company_persons[company_id].add(person_id)
                if not graph.has_edge(person_id, company_id, key=EdgeType.DIRECTOR_OF.value):
                    _add_edge(graph, person_id, company_id, EdgeType.DIRECTOR_OF)

        # ------------------------------------------------------ address edges
        if record.address:
            address_id = dataset.addresses.resolve(record.address)
            _add_node(graph, address_id, NodeType.ADDRESS,
                      dataset.addresses.display(address_id))
            company_addresses[company_id].add(address_id)
            if not graph.has_edge(company_id, address_id, key=EdgeType.REGISTERED_AT.value):
                _add_edge(graph, company_id, address_id, EdgeType.REGISTERED_AT)

        # --------------------------------------------------- department edges
        if record.department_id or record.department_name:
            department_id = dataset.departments.resolve(record.department_id or "")
            if department_id:
                _add_node(graph, department_id, NodeType.DEPARTMENT,
                          dataset.departments.display(department_id))
                tender_department[tender_id] = department_id
                if not graph.has_edge(tender_id, department_id, key=EdgeType.ISSUED_BY.value):
                    _add_edge(graph, tender_id, department_id, EdgeType.ISSUED_BY)

        if record.label is not None:
            labels[company_id] = int(record.label)

    # ------------------------------------------------------------ OWNS edges
    for person_id, company_id in _derive_ownership(company_persons):
        if graph.has_node(person_id) and graph.has_node(company_id):
            if not graph.has_edge(person_id, company_id, key=EdgeType.OWNS.value):
                _add_edge(graph, person_id, company_id, EdgeType.OWNS, derived=True)

    # ---------------------------------------------------------- CO_BID edges
    for tender_id, companies in tender_companies.items():
        for a, b in combinations(sorted(companies), 2):
            if graph.has_edge(a, b, key=EdgeType.CO_BID.value):
                data = graph.edges[a, b, EdgeType.CO_BID.value]
                data["weight"] = float(data.get("weight", 1.0)) + 1.0
                data["tenders"].append(tender_id)
            else:
                _add_edge(graph, a, b, EdgeType.CO_BID, weight=1.0,
                          tenders=[tender_id])

    procurement_graph = ProcurementGraph(
        graph=graph,
        company_tenders={k: set(v) for k, v in company_tenders.items()},
        tender_companies={k: set(v) for k, v in tender_companies.items()},
        tender_winner=tender_winner,
        tender_department=tender_department,
        company_persons={k: set(v) for k, v in company_persons.items()},
        company_addresses={k: set(v) for k, v in company_addresses.items()},
        bids=bids,
        company_tender_documents={k: set(v) for k, v in company_tender_documents.items()},
        labels=labels,
    )
    LOGGER.info("graph built: %s", procurement_graph.stats())
    return procurement_graph


def export_nodes(
    procurement_graph: ProcurementGraph, limit: Optional[int] = None
) -> List[Dict[str, object]]:
    """Serialise nodes for API responses / visualisation layers."""
    nodes: List[Dict[str, object]] = []
    for node_id, data in procurement_graph.graph.nodes(data=True):
        nodes.append(
            {
                "id": node_id,
                "type": data.get("node_type"),
                "label": data.get("display", node_id),
                "degree": procurement_graph.graph.degree(node_id),
            }
        )
        if limit is not None and len(nodes) >= limit:
            break
    return nodes


def export_edges(
    procurement_graph: ProcurementGraph, limit: Optional[int] = None
) -> List[Dict[str, object]]:
    edges: List[Dict[str, object]] = []
    for source, target, data in procurement_graph.graph.edges(data=True):
        edges.append(
            {
                "source": source,
                "target": target,
                "type": data.get("edge_type"),
                "weight": float(data.get("weight", 1.0)),
            }
        )
        if limit is not None and len(edges) >= limit:
            break
    return edges


def ego_network(
    procurement_graph: ProcurementGraph, node_id: str, depth: int = 2
) -> Tuple[List[Dict[str, object]], List[Dict[str, object]]]:
    """Neighbourhood around a node, as node/edge lists."""
    if not procurement_graph.has_node(node_id):
        return [], []
    simple = procurement_graph.graph.to_undirected(as_view=True)
    reachable = nx.single_source_shortest_path_length(simple, node_id, cutoff=depth)
    subgraph = procurement_graph.graph.subgraph(reachable.keys())

    nodes = [
        {
            "id": n,
            "type": d.get("node_type"),
            "label": d.get("display", n),
            "hops": reachable[n],
        }
        for n, d in subgraph.nodes(data=True)
    ]
    edges = [
        {
            "source": s,
            "target": t,
            "type": d.get("edge_type"),
            "weight": float(d.get("weight", 1.0)),
        }
        for s, t, d in subgraph.edges(data=True)
    ]
    return nodes, edges


def iter_company_pairs(procurement_graph: ProcurementGraph) -> Iterable[Tuple[str, str, int]]:
    """Yield ``(company_a, company_b, shared_tender_count)`` for co-bidders."""
    for source, target, data in procurement_graph.graph.edges(data=True):
        if data.get("edge_type") == EdgeType.CO_BID.value:
            yield source, target, int(data.get("weight", 1))
