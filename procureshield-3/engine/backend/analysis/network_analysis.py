"""NetworkX-based structural analysis: centrality, communities, dense groups.

Everything here is deterministic given a graph, so repeated runs on the same
data produce identical output (important when an analyst re-opens a case).
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Set, Tuple

import networkx as nx

from ..graph.builder import ProcurementGraph
from ..logging_utils import get_logger

LOGGER = get_logger("analysis.network")

#: Above this node count, betweenness switches to sampling for tractability.
BETWEENNESS_EXACT_LIMIT = 400
BETWEENNESS_SAMPLES = 150


@dataclass
class CentralityScores:
    degree: Dict[str, float] = field(default_factory=dict)
    weighted_degree: Dict[str, float] = field(default_factory=dict)
    betweenness: Dict[str, float] = field(default_factory=dict)
    pagerank: Dict[str, float] = field(default_factory=dict)
    eigenvector: Dict[str, float] = field(default_factory=dict)
    clustering: Dict[str, float] = field(default_factory=dict)

    def for_node(self, node_id: str) -> Dict[str, float]:
        return {
            "degree_centrality": float(self.degree.get(node_id, 0.0)),
            "weighted_degree": float(self.weighted_degree.get(node_id, 0.0)),
            "betweenness": float(self.betweenness.get(node_id, 0.0)),
            "pagerank": float(self.pagerank.get(node_id, 0.0)),
            "eigenvector": float(self.eigenvector.get(node_id, 0.0)),
            "clustering_coefficient": float(self.clustering.get(node_id, 0.0)),
        }


@dataclass
class CommunityReport:
    """Community assignment over the company projection."""

    membership: Dict[str, int] = field(default_factory=dict)
    sizes: Dict[int, int] = field(default_factory=dict)
    density: Dict[int, float] = field(default_factory=dict)
    modularity: float = 0.0
    algorithm: str = "greedy_modularity"

    def members(self, community_id: int) -> List[str]:
        return sorted(k for k, v in self.membership.items() if v == community_id)

    def community_of(self, node_id: str) -> Optional[int]:
        return self.membership.get(node_id)


def compute_centrality(procurement_graph: ProcurementGraph) -> CentralityScores:
    """Centrality over the weighted undirected projection of the full graph."""
    simple = procurement_graph.undirected_projection()
    if simple.number_of_nodes() == 0:
        return CentralityScores()

    degree = nx.degree_centrality(simple)
    weighted_degree = {n: float(d) for n, d in simple.degree(weight="weight")}

    if simple.number_of_nodes() <= BETWEENNESS_EXACT_LIMIT:
        betweenness = nx.betweenness_centrality(simple, weight=None, seed=0)
    else:
        k = min(BETWEENNESS_SAMPLES, simple.number_of_nodes())
        betweenness = nx.betweenness_centrality(simple, k=k, weight=None, seed=0)

    pagerank = nx.pagerank(simple, weight="weight")

    try:
        eigenvector = nx.eigenvector_centrality_numpy(simple, weight="weight")
        eigenvector = {k: float(abs(v)) for k, v in eigenvector.items()}
    except Exception:  # pragma: no cover - singular / disconnected edge cases
        LOGGER.warning("eigenvector centrality unavailable; falling back to pagerank")
        eigenvector = dict(pagerank)

    clustering = nx.clustering(simple)

    return CentralityScores(
        degree=degree,
        weighted_degree=weighted_degree,
        betweenness=betweenness,
        pagerank=pagerank,
        eigenvector=eigenvector,
        clustering={k: float(v) for k, v in clustering.items()},
    )


def detect_communities(procurement_graph: ProcurementGraph) -> CommunityReport:
    """Partition the company projection into communities.

    Louvain is used when available (NetworkX >= 3.0) with a fixed seed, falling
    back to greedy modularity, then to connected components.
    """
    projection = procurement_graph.company_projection()
    if projection.number_of_nodes() == 0:
        return CommunityReport()

    algorithm = "louvain"
    try:
        communities: Sequence[Set[str]] = nx.community.louvain_communities(
            projection, weight="weight", seed=0
        )
    except Exception:  # pragma: no cover - depends on NetworkX build
        try:
            communities = list(
                nx.community.greedy_modularity_communities(projection, weight="weight")
            )
            algorithm = "greedy_modularity"
        except Exception:
            communities = list(nx.connected_components(projection))
            algorithm = "connected_components"

    membership: Dict[str, int] = {}
    sizes: Dict[int, int] = {}
    density: Dict[int, float] = {}
    for index, community in enumerate(communities):
        members = sorted(community)
        sizes[index] = len(members)
        for node in members:
            membership[node] = index
        subgraph = projection.subgraph(members)
        density[index] = float(nx.density(subgraph)) if len(members) > 1 else 0.0

    try:
        modularity = float(
            nx.community.modularity(projection, communities, weight="weight")
        )
    except Exception:  # pragma: no cover
        modularity = 0.0

    LOGGER.info(
        "communities: %d groups via %s (modularity %.3f)",
        len(sizes), algorithm, modularity,
    )
    return CommunityReport(
        membership=membership,
        sizes=sizes,
        density=density,
        modularity=modularity,
        algorithm=algorithm,
    )


def normalised_entropy(counts: Sequence[int]) -> float:
    """Shannon entropy of a discrete distribution, scaled to ``[0, 1]``.

    A value near 1 means outcomes are spread evenly across participants - which
    in a bidding cluster is the signature of *rotation* rather than competition.
    """
    total = sum(counts)
    if total <= 0 or len(counts) <= 1:
        return 0.0
    entropy = 0.0
    for count in counts:
        if count <= 0:
            continue
        p = count / total
        entropy -= p * math.log(p)
    return float(entropy / math.log(len(counts)))


@dataclass
class ClusterBehaviour:
    """Bidding behaviour of a community, used for rotation / capture signals."""

    community_id: int
    members: List[str]
    tenders: List[str]
    winner_counts: Dict[str, int]
    rotation_entropy: float
    capture_ratio: float  # share of cluster tenders won by cluster members
    win_concentration: float  # share of cluster wins taken by the single top member
    density: float


def analyse_cluster_behaviour(
    procurement_graph: ProcurementGraph, communities: CommunityReport
) -> Dict[int, ClusterBehaviour]:
    """Per-community bidding statistics (which tenders, who won, how evenly)."""
    behaviour: Dict[int, ClusterBehaviour] = {}
    for community_id, size in communities.sizes.items():
        members = communities.members(community_id)
        member_set = set(members)

        tender_hits: Counter[str] = Counter()
        for member in members:
            for tender in procurement_graph.company_tenders.get(member, set()):
                tender_hits[tender] += 1
        # Tenders genuinely "owned" by the cluster: two or more members bidding.
        cluster_tenders = [t for t, hits in tender_hits.items() if hits >= 2]

        winner_counts: Counter[str] = Counter()
        captured = 0
        for tender in cluster_tenders:
            winner = procurement_graph.tender_winner.get(tender)
            if winner is None:
                continue
            if winner in member_set:
                captured += 1
                winner_counts[winner] += 1

        counts = [winner_counts.get(member, 0) for member in members]
        rotation = normalised_entropy([c for c in counts if c > 0] or [0])
        total_wins = sum(winner_counts.values())
        concentration = (
            max(winner_counts.values()) / total_wins if total_wins else 0.0
        )
        capture_ratio = captured / len(cluster_tenders) if cluster_tenders else 0.0

        behaviour[community_id] = ClusterBehaviour(
            community_id=community_id,
            members=members,
            tenders=sorted(cluster_tenders),
            winner_counts=dict(winner_counts),
            rotation_entropy=rotation,
            capture_ratio=float(capture_ratio),
            win_concentration=float(concentration),
            density=communities.density.get(community_id, 0.0),
        )
        _ = size
    return behaviour


def shared_attribute_groups(
    mapping: Dict[str, Set[str]]
) -> Dict[str, List[str]]:
    """Invert ``company -> {attribute}`` keeping attributes shared by 2+ firms."""
    inverted: Dict[str, Set[str]] = defaultdict(set)
    for company, attributes in mapping.items():
        for attribute in attributes:
            inverted[attribute].add(company)
    return {k: sorted(v) for k, v in inverted.items() if len(v) > 1}


def dense_bidding_groups(
    procurement_graph: ProcurementGraph, min_size: int = 3, min_weight: float = 3.0
) -> List[Tuple[List[str], float]]:
    """Cliques of companies that repeatedly bid against each other.

    Returns ``(members, mean_cobid_weight)`` sorted by strength. A high-weight
    clique means the same firms keep appearing in the same tenders - a pattern
    worth a human look, not proof of anything.
    """
    projection = procurement_graph.company_projection()
    strong = nx.Graph()
    strong.add_nodes_from(projection.nodes)
    for a, b, data in projection.edges(data=True):
        if float(data.get("weight", 0.0)) >= min_weight:
            strong.add_edge(a, b, weight=float(data["weight"]))

    groups: List[Tuple[List[str], float]] = []
    for clique in nx.find_cliques(strong):
        if len(clique) < min_size:
            continue
        members = sorted(clique)
        weights = [
            float(strong[a][b]["weight"])
            for i, a in enumerate(members)
            for b in members[i + 1 :]
            if strong.has_edge(a, b)
        ]
        if not weights:
            continue
        groups.append((members, sum(weights) / len(weights)))
    groups.sort(key=lambda item: (-item[1], -len(item[0])))
    return groups
