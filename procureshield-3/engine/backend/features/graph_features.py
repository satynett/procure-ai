"""Feature engineering over the procurement graph.

Three feature tables are produced:

* **company features** - the model's node feature matrix and the input to the
  rule engine;
* **pair features** - company-to-company relationship metrics that power the
  ``suspicious_relationships`` output;
* **tender features** - per-tender competition metrics.

No feature is derived from the supervision label, so there is no target leakage
through the feature matrix.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Set, Tuple

import numpy as np
import pandas as pd

from ..analysis.network_analysis import (
    CentralityScores,
    ClusterBehaviour,
    CommunityReport,
    analyse_cluster_behaviour,
    compute_centrality,
    detect_communities,
    normalised_entropy,
    shared_attribute_groups,
)
from ..graph.builder import ProcurementGraph
from ..graph.schema import EdgeType
from ..logging_utils import get_logger

LOGGER = get_logger("features")

#: Order matters: this is the GNN input layout and must stay stable across
#: train/inference runs.
COMPANY_FEATURE_COLUMNS: List[str] = [
    "n_tenders",
    "n_wins",
    "win_rate",
    "shared_director_peers",
    "max_shared_directors",
    "shared_address_peers",
    "cobid_partners",
    "max_cobid_count",
    "top_partner_ratio",
    "mean_cobid_weight",
    "min_pair_price_gap",
    "mean_pair_price_gap",
    "complementary_bid_ratio",
    "bid_to_estimate_ratio",
    "bid_ratio_std",
    "cluster_rotation_entropy",
    "cluster_capture_ratio",
    "cluster_win_concentration",
    "community_size",
    "community_density",
    "department_concentration",
    "degree_centrality",
    "weighted_degree",
    "betweenness",
    "pagerank",
    "eigenvector",
    "clustering_coefficient",
]


@dataclass
class PairFeature:
    """Relationship metrics for one pair of companies."""

    company_a: str
    company_b: str
    shared_tenders: int
    shared_directors: int
    shared_addresses: int
    cobid_ratio: float
    mean_price_gap: Optional[float]
    alternating_wins: int
    shared_document_hashes: int
    same_community: bool

    def to_dict(self) -> Dict[str, object]:
        return {
            "company_a": self.company_a,
            "company_b": self.company_b,
            "shared_tenders": self.shared_tenders,
            "shared_directors": self.shared_directors,
            "shared_addresses": self.shared_addresses,
            "cobid_ratio": round(self.cobid_ratio, 4),
            "mean_price_gap": (
                None if self.mean_price_gap is None else round(self.mean_price_gap, 4)
            ),
            "alternating_wins": self.alternating_wins,
            "shared_document_hashes": self.shared_document_hashes,
            "same_community": self.same_community,
        }


@dataclass
class FeatureBundle:
    """Everything the scoring and model layers need."""

    company_features: pd.DataFrame
    pair_features: List[PairFeature]
    tender_features: pd.DataFrame
    centrality: CentralityScores
    communities: CommunityReport
    cluster_behaviour: Dict[int, ClusterBehaviour] = field(default_factory=dict)

    def company_row(self, company_id: str) -> Optional[Dict[str, float]]:
        if company_id not in self.company_features.index:
            return None
        return self.company_features.loc[company_id].to_dict()

    def matrix(self) -> Tuple[np.ndarray, List[str]]:
        """Feature matrix ``X`` and the company ids aligned to its rows."""
        frame = self.company_features.reindex(columns=COMPANY_FEATURE_COLUMNS).fillna(0.0)
        return frame.to_numpy(dtype=np.float32), list(frame.index)


# --------------------------------------------------------------------- helpers
def _bid_amount(pg: ProcurementGraph, company: str, tender: str) -> Optional[float]:
    bid = pg.bids.get((company, tender))
    if not bid:
        return None
    amount = bid.get("bid_amount")
    return float(amount) if amount is not None else None


def _relative_gap(a: Optional[float], b: Optional[float]) -> Optional[float]:
    if a is None or b is None:
        return None
    base = max(abs(a), abs(b))
    if base == 0:
        return None
    return abs(a - b) / base


def _safe_std(values: Sequence[float]) -> float:
    return float(statistics.pstdev(values)) if len(values) > 1 else 0.0


# ------------------------------------------------------------------- features
def compute_pair_features(
    pg: ProcurementGraph, communities: CommunityReport
) -> List[PairFeature]:
    """Metrics for every pair of companies that bid in at least one shared tender."""
    pairs: List[PairFeature] = []
    for source, target, data in pg.graph.edges(data=True):
        if data.get("edge_type") != EdgeType.CO_BID.value:
            continue
        shared_tenders: List[str] = list(data.get("tenders", []))
        if not shared_tenders:
            continue

        gaps: List[float] = []
        shared_documents: Set[str] = set()
        alternating = 0
        winners: List[str] = []
        for tender in shared_tenders:
            shared_documents.update(pg.company_tender_documents.get((source, tender), set()) & pg.company_tender_documents.get((target, tender), set()))
            gap = _relative_gap(
                _bid_amount(pg, source, tender), _bid_amount(pg, target, tender)
            )
            if gap is not None:
                gaps.append(gap)
            winner = pg.tender_winner.get(tender)
            if winner in (source, target):
                winners.append(winner)  # type: ignore[arg-type]
        for previous, current in zip(winners, winners[1:]):
            if previous != current:
                alternating += 1

        total_tenders = min(
            len(pg.company_tenders.get(source, set())),
            len(pg.company_tenders.get(target, set())),
        ) or 1

        pairs.append(
            PairFeature(
                company_a=source,
                company_b=target,
                shared_tenders=len(shared_tenders),
                shared_directors=len(
                    pg.company_persons.get(source, set())
                    & pg.company_persons.get(target, set())
                ),
                shared_addresses=len(
                    pg.company_addresses.get(source, set())
                    & pg.company_addresses.get(target, set())
                ),
                cobid_ratio=len(shared_tenders) / total_tenders,
                mean_price_gap=(sum(gaps) / len(gaps)) if gaps else None,
                alternating_wins=alternating,
                shared_document_hashes=len(shared_documents),
                same_community=(
                    communities.community_of(source) is not None
                    and communities.community_of(source) == communities.community_of(target)
                ),
            )
        )
    pairs.sort(key=lambda p: (-p.shared_tenders, p.company_a, p.company_b))
    return pairs


def compute_tender_features(pg: ProcurementGraph) -> pd.DataFrame:
    """Competition metrics per tender."""
    rows: List[Dict[str, object]] = []
    for tender in pg.tenders:
        bidders = sorted(pg.tender_companies.get(tender, set()))
        amounts = [a for a in (_bid_amount(pg, c, tender) for c in bidders) if a is not None]
        winner = pg.tender_winner.get(tender)
        winning_bid = _bid_amount(pg, winner, tender) if winner else None
        estimate = pg.graph.nodes[tender].get("tender_value")

        spread = None
        if len(amounts) > 1:
            lowest, highest = min(amounts), max(amounts)
            spread = (highest - lowest) / highest if highest else None

        losing_margins = [
            (amount - winning_bid) / winning_bid
            for amount in amounts
            if winning_bid and amount > winning_bid
        ]

        rows.append(
            {
                "tender_id": tender,
                "n_bidders": len(bidders),
                "bid_spread": spread,
                "min_bid": min(amounts) if amounts else None,
                "max_bid": max(amounts) if amounts else None,
                "winning_bid": winning_bid,
                "tender_value": estimate,
                "winning_margin_vs_estimate": (
                    (winning_bid - estimate) / estimate
                    if winning_bid is not None and estimate else None
                ),
                "mean_losing_margin": (
                    sum(losing_margins) / len(losing_margins) if losing_margins else None
                ),
                "losing_margin_std": _safe_std(losing_margins) if losing_margins else None,
                "single_bidder": len(bidders) <= 1,
                "department_id": pg.tender_department.get(tender),
                "winner_id": winner,
            }
        )
    frame = pd.DataFrame(rows)
    if not frame.empty:
        frame = frame.set_index("tender_id")
    return frame


def compute_company_features(
    pg: ProcurementGraph,
    centrality: CentralityScores,
    communities: CommunityReport,
    cluster_behaviour: Dict[int, ClusterBehaviour],
    pair_features: Sequence[PairFeature],
) -> pd.DataFrame:
    """Build the per-company feature table (the GNN node feature matrix)."""
    director_groups = shared_attribute_groups(pg.company_persons)
    address_groups = shared_attribute_groups(pg.company_addresses)

    peers_by_director: Dict[str, Set[str]] = {}
    directors_shared_max: Dict[str, int] = {}
    for _, members in director_groups.items():
        for member in members:
            peers_by_director.setdefault(member, set()).update(
                m for m in members if m != member
            )
    for company, peers in peers_by_director.items():
        directors_shared_max[company] = max(
            (
                len(pg.company_persons.get(company, set()) & pg.company_persons.get(peer, set()))
                for peer in peers
            ),
            default=0,
        )

    peers_by_address: Dict[str, Set[str]] = {}
    for _, members in address_groups.items():
        for member in members:
            peers_by_address.setdefault(member, set()).update(
                m for m in members if m != member
            )

    pairs_by_company: Dict[str, List[PairFeature]] = {}
    for pair in pair_features:
        pairs_by_company.setdefault(pair.company_a, []).append(pair)
        pairs_by_company.setdefault(pair.company_b, []).append(pair)

    rows: Dict[str, Dict[str, float]] = {}
    for company in pg.companies:
        tenders = sorted(pg.company_tenders.get(company, set()))
        n_tenders = len(tenders)
        wins = [t for t in tenders if pg.tender_winner.get(t) == company]

        # --------------------------------------------------------- pricing
        ratios: List[float] = []
        complementary = 0
        loss_count = 0
        for tender in tenders:
            amount = _bid_amount(pg, company, tender)
            estimate = pg.graph.nodes[tender].get("tender_value")
            if amount is not None and estimate:
                ratios.append(amount / float(estimate))
            winner = pg.tender_winner.get(tender)
            if winner and winner != company:
                loss_count += 1
                winning_bid = _bid_amount(pg, winner, tender)
                if winning_bid and amount:
                    margin = (amount - winning_bid) / winning_bid
                    # Losing by a small, consistent margin is the classic
                    # "cover bid" footprint.
                    if 0.01 <= margin <= 0.12:
                        complementary += 1

        # ----------------------------------------------------- co-bidding
        company_pairs = pairs_by_company.get(company, [])
        cobid_counts = [p.shared_tenders for p in company_pairs]
        # Price similarity is only meaningful against *repeat* opponents: two
        # firms that met once and happened to bid alike is coincidence.
        frequent_pairs = [p for p in company_pairs if p.shared_tenders >= 3]
        price_gaps = [
            p.mean_price_gap for p in frequent_pairs if p.mean_price_gap is not None
        ]

        community_id = communities.community_of(company)
        behaviour = cluster_behaviour.get(community_id) if community_id is not None else None

        departments = [
            pg.tender_department.get(t) for t in tenders if pg.tender_department.get(t)
        ]
        dept_counts = pd.Series(departments).value_counts() if departments else pd.Series(dtype=int)
        dept_concentration = (
            float(dept_counts.iloc[0] / len(departments)) if len(departments) else 0.0
        )

        centrality_row = centrality.for_node(company)

        rows[company] = {
            "n_tenders": float(n_tenders),
            "n_wins": float(len(wins)),
            "win_rate": float(len(wins) / n_tenders) if n_tenders else 0.0,
            "shared_director_peers": float(len(peers_by_director.get(company, set()))),
            "max_shared_directors": float(directors_shared_max.get(company, 0)),
            "shared_address_peers": float(len(peers_by_address.get(company, set()))),
            "cobid_partners": float(len(company_pairs)),
            "max_cobid_count": float(max(cobid_counts) if cobid_counts else 0),
            "top_partner_ratio": float(
                (max(cobid_counts) / n_tenders) if cobid_counts and n_tenders else 0.0
            ),
            "mean_cobid_weight": float(
                sum(cobid_counts) / len(cobid_counts) if cobid_counts else 0.0
            ),
            "min_pair_price_gap": float(min(price_gaps)) if price_gaps else 1.0,
            "mean_pair_price_gap": float(
                sum(price_gaps) / len(price_gaps)
            ) if price_gaps else 1.0,
            "complementary_bid_ratio": float(complementary / loss_count) if loss_count else 0.0,
            "bid_to_estimate_ratio": float(sum(ratios) / len(ratios)) if ratios else 0.0,
            "bid_ratio_std": _safe_std(ratios),
            "cluster_rotation_entropy": float(behaviour.rotation_entropy) if behaviour else 0.0,
            "cluster_capture_ratio": float(behaviour.capture_ratio) if behaviour else 0.0,
            "cluster_win_concentration": float(behaviour.win_concentration) if behaviour else 0.0,
            "community_size": float(
                communities.sizes.get(community_id, 0) if community_id is not None else 0
            ),
            "community_density": float(
                communities.density.get(community_id, 0.0) if community_id is not None else 0.0
            ),
            "department_concentration": dept_concentration,
            **centrality_row,
        }

    frame = pd.DataFrame.from_dict(rows, orient="index")
    frame.index.name = "company_id"
    frame = frame.reindex(columns=COMPANY_FEATURE_COLUMNS).fillna(0.0)
    LOGGER.info("computed %d company feature rows", len(frame))
    return frame


def build_features(pg: ProcurementGraph) -> FeatureBundle:
    """Run the full feature pipeline for a built graph."""
    centrality = compute_centrality(pg)
    communities = detect_communities(pg)
    behaviour = analyse_cluster_behaviour(pg, communities)
    pair_features = compute_pair_features(pg, communities)
    company_features = compute_company_features(
        pg, centrality, communities, behaviour, pair_features
    )
    tender_features = compute_tender_features(pg)
    return FeatureBundle(
        company_features=company_features,
        pair_features=pair_features,
        tender_features=tender_features,
        centrality=centrality,
        communities=communities,
        cluster_behaviour=behaviour,
    )


def percentile_threshold(values: Sequence[float], percentile: float) -> float:
    """Percentile helper used by threshold-based signals."""
    array = np.asarray([v for v in values if v is not None], dtype=float)
    if array.size == 0:
        return 0.0
    return float(np.quantile(array, percentile))


__all__ = [
    "COMPANY_FEATURE_COLUMNS",
    "FeatureBundle",
    "PairFeature",
    "build_features",
    "compute_company_features",
    "compute_pair_features",
    "compute_tender_features",
    "percentile_threshold",
    "normalised_entropy",
]
