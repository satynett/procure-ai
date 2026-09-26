"""Explicit, auditable risk signals derived from graph features.

Each signal answers one investigative question, reports a severity in ``[0, 1]``
and carries the evidence that produced it. A signal returns ``None`` when the
underlying data is absent (for example no addresses in the feed), and those
signals are excluded from the denominator of the rule score rather than counted
as "clean" - so a sparse dataset cannot silently suppress risk.

Nothing here asserts wrongdoing. Signals describe *patterns that warrant review*.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from ..config import FeatureThresholds, ScoreWeights, Settings
from ..features.graph_features import FeatureBundle, PairFeature, percentile_threshold
from ..graph.builder import ProcurementGraph
from ..logging_utils import get_logger

LOGGER = get_logger("analysis.signals")


@dataclass
class RiskSignal:
    """One triggered risk indicator for one entity."""

    code: str
    label: str
    severity: float           # 0-1, how pronounced the pattern is
    weight: float             # configured importance of this signal
    description: str          # analyst-facing, hedged language
    evidence: Dict[str, object] = field(default_factory=dict)
    related_entities: List[str] = field(default_factory=list)

    @property
    def contribution(self) -> float:
        return self.severity * self.weight

    def to_dict(self) -> Dict[str, object]:
        return {
            "code": self.code,
            "label": self.label,
            "severity": round(float(self.severity), 4),
            "weight": round(float(self.weight), 3),
            "description": self.description,
            "evidence": self.evidence,
            "related_entities": self.related_entities,
        }


@dataclass
class SignalOutcome:
    """Result of evaluating one signal: triggered, clean, or not evaluable."""

    evaluable: bool
    signal: Optional[RiskSignal] = None
    weight: float = 0.0


def _ratio(value: float, threshold: float, ceiling: Optional[float] = None) -> float:
    """Scale ``value`` into ``[0, 1]`` relative to a trigger threshold."""
    if threshold <= 0:
        return 1.0 if value > 0 else 0.0
    top = ceiling if ceiling is not None else threshold * 2.5
    if top <= threshold:
        return 1.0
    return float(min(1.0, max(0.0, (value - threshold) / (top - threshold)))) * 0.6 + 0.4


def _display(pg: ProcurementGraph, node_id: str) -> str:
    return pg.node_display(node_id)


class RiskSignalEngine:
    """Evaluates every configured signal for every company."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.thresholds: FeatureThresholds = settings.thresholds
        self.weights: ScoreWeights = settings.weights

    # ---------------------------------------------------------------- public
    def evaluate_company(
        self,
        company_id: str,
        pg: ProcurementGraph,
        bundle: FeatureBundle,
        pairs_by_company: Dict[str, List[PairFeature]],
        degree_cutoff: float,
        data_flags: Dict[str, bool],
    ) -> Tuple[List[RiskSignal], float]:
        """Return triggered signals and the normalised rule score in ``[0, 1]``."""
        row = bundle.company_row(company_id)
        if row is None:
            return [], 0.0

        outcomes: List[SignalOutcome] = [
            self._shared_directors(company_id, pg, row, pairs_by_company, data_flags),
            self._shared_address(company_id, pg, row, pairs_by_company, data_flags),
            self._cobid_frequency(company_id, pg, row, pairs_by_company),
            self._price_similarity(company_id, pg, row, pairs_by_company, data_flags),
            self._duplicate_bid_documents(company_id, pg, pairs_by_company),
            self._complementary_bidding(company_id, row, data_flags),
            self._winner_rotation(company_id, pg, bundle, row),
            self._market_concentration(company_id, row),
            self._high_centrality(company_id, row, degree_cutoff),
            self._dense_community(company_id, bundle, row),
            self._single_bidder(company_id, pg, bundle),
        ]

        signals = [o.signal for o in outcomes if o.signal is not None]
        evaluable_weight = sum(o.weight for o in outcomes if o.evaluable)
        earned = sum(s.contribution for s in signals)
        rule_score = float(earned / evaluable_weight) if evaluable_weight > 0 else 0.0
        signals.sort(key=lambda s: -s.contribution)
        return signals, min(1.0, rule_score)

    # ------------------------------------------------------------- signals
    def _shared_directors(
        self,
        company_id: str,
        pg: ProcurementGraph,
        row: Dict[str, float],
        pairs_by_company: Dict[str, List[PairFeature]],
        data_flags: Dict[str, bool],
    ) -> SignalOutcome:
        weight = self.weights.shared_directors
        if not data_flags.get("has_person_data"):
            return SignalOutcome(evaluable=False)
        peers = int(row.get("shared_director_peers", 0))
        if peers < self.thresholds.min_shared_directors:
            return SignalOutcome(evaluable=True, weight=weight)

        linked = [
            p for p in pairs_by_company.get(company_id, []) if p.shared_directors > 0
        ]
        related = sorted(
            {p.company_b if p.company_a == company_id else p.company_a for p in linked}
        )
        return SignalOutcome(
            evaluable=True,
            weight=weight,
            signal=RiskSignal(
                code="SHARED_DIRECTORS",
                label="Common officers across competing bidders",
                severity=_ratio(peers, self.thresholds.min_shared_directors, ceiling=4),
                weight=weight,
                description=(
                    f"Shares at least one director or controlling officer with "
                    f"{peers} other bidding compan{'y' if peers == 1 else 'ies'}. "
                    "Competing bids from commonly controlled entities may not be "
                    "independent and should be verified against the corporate registry."
                ),
                evidence={
                    "shared_director_peers": peers,
                    "max_shared_directors_with_one_peer": int(
                        row.get("max_shared_directors", 0)
                    ),
                    "peer_companies": [_display(pg, c) for c in related[:8]],
                },
                related_entities=related[:8],
            ),
        )

    def _shared_address(
        self,
        company_id: str,
        pg: ProcurementGraph,
        row: Dict[str, float],
        pairs_by_company: Dict[str, List[PairFeature]],
        data_flags: Dict[str, bool],
    ) -> SignalOutcome:
        weight = self.weights.shared_address
        if not data_flags.get("has_address_data"):
            return SignalOutcome(evaluable=False)
        peers = int(row.get("shared_address_peers", 0))
        if peers < self.thresholds.min_shared_address_peers:
            return SignalOutcome(evaluable=True, weight=weight)

        related = sorted(
            {
                p.company_b if p.company_a == company_id else p.company_a
                for p in pairs_by_company.get(company_id, [])
                if p.shared_addresses > 0
            }
        )
        addresses = [
            _display(pg, a) for a in sorted(pg.company_addresses.get(company_id, set()))
        ]
        return SignalOutcome(
            evaluable=True,
            weight=weight,
            signal=RiskSignal(
                code="SHARED_ADDRESS",
                label="Registered address shared with other bidders",
                severity=_ratio(peers, self.thresholds.min_shared_address_peers, ceiling=4),
                weight=weight,
                description=(
                    f"Registered at an address also used by {peers} other bidding "
                    f"compan{'y' if peers == 1 else 'ies'} after address "
                    "normalisation. This can be legitimate (shared business parks, "
                    "agents) and needs confirmation against registry records."
                ),
                evidence={
                    "shared_address_peers": peers,
                    "addresses": addresses[:5],
                    "peer_companies": [_display(pg, c) for c in related[:8]],
                },
                related_entities=related[:8],
            ),
        )

    def _cobid_frequency(
        self,
        company_id: str,
        pg: ProcurementGraph,
        row: Dict[str, float],
        pairs_by_company: Dict[str, List[PairFeature]],
    ) -> SignalOutcome:
        weight = self.weights.cobid_frequency
        max_cobid = int(row.get("max_cobid_count", 0))
        ratio = float(row.get("top_partner_ratio", 0.0))
        if (
            max_cobid < self.thresholds.min_cobid_events
            or ratio < self.thresholds.high_cobid_ratio
        ):
            return SignalOutcome(evaluable=True, weight=weight)

        top_pairs = sorted(
            pairs_by_company.get(company_id, []), key=lambda p: -p.shared_tenders
        )[:3]
        related = [
            p.company_b if p.company_a == company_id else p.company_a for p in top_pairs
        ]
        return SignalOutcome(
            evaluable=True,
            weight=weight,
            signal=RiskSignal(
                code="REPEATED_CO_BIDDING",
                label="Repeatedly bids alongside the same counterparties",
                severity=_ratio(ratio, self.thresholds.high_cobid_ratio, ceiling=1.0),
                weight=weight,
                description=(
                    f"Appears in the same tender as one counterparty {max_cobid} times, "
                    f"covering {ratio:.0%} of its bidding activity. Persistent pairing "
                    "is consistent with a stable bidding group and merits review of "
                    "whether these firms compete independently."
                ),
                evidence={
                    "max_shared_tenders_with_one_peer": max_cobid,
                    "share_of_own_tenders": round(ratio, 3),
                    "top_counterparties": [
                        {
                            "company": _display(pg, c),
                            "shared_tenders": p.shared_tenders,
                        }
                        for c, p in zip(related, top_pairs)
                    ],
                },
                related_entities=related,
            ),
        )

    def _price_similarity(
        self,
        company_id: str,
        pg: ProcurementGraph,
        row: Dict[str, float],
        pairs_by_company: Dict[str, List[PairFeature]],
        data_flags: Dict[str, bool],
    ) -> SignalOutcome:
        weight = self.weights.bid_price_similarity
        if not data_flags.get("has_bid_amounts"):
            return SignalOutcome(evaluable=False)
        gap = float(row.get("min_pair_price_gap", 1.0))
        if gap > self.thresholds.bid_similarity_pct:
            return SignalOutcome(evaluable=True, weight=weight)

        tight = [
            p
            for p in pairs_by_company.get(company_id, [])
            if p.mean_price_gap is not None
            and p.mean_price_gap <= self.thresholds.bid_similarity_pct
            and p.shared_tenders >= 3
        ]
        related = [
            p.company_b if p.company_a == company_id else p.company_a for p in tight
        ]
        severity = float(
            min(1.0, max(0.4, 1.0 - gap / max(self.thresholds.bid_similarity_pct, 1e-9) * 0.6))
        )
        return SignalOutcome(
            evaluable=True,
            weight=weight,
            signal=RiskSignal(
                code="BID_PRICE_SIMILARITY",
                label="Unusually tight bid prices against repeat opponents",
                severity=severity,
                weight=weight,
                description=(
                    f"Bids sit within {gap:.2%} of a repeat counterparty's bids on "
                    "average across tenders they both entered. Independent pricing "
                    "normally varies far more; the underlying cost estimates should "
                    "be compared before drawing any conclusion."
                ),
                evidence={
                    "closest_mean_price_gap": round(gap, 4),
                    "threshold": self.thresholds.bid_similarity_pct,
                    "counterparties": [
                        {
                            "company": _display(pg, c),
                            "mean_price_gap": round(float(p.mean_price_gap or 0.0), 4),
                            "shared_tenders": p.shared_tenders,
                        }
                        for c, p in zip(related, tight)
                    ][:5],
                },
                related_entities=related[:5],
            ),
        )

    def _duplicate_bid_documents(
        self,
        company_id: str,
        pg: ProcurementGraph,
        pairs_by_company: Dict[str, List[PairFeature]],
    ) -> SignalOutcome:
        weight = self.weights.duplicate_bid_documents
        matches = [p for p in pairs_by_company.get(company_id, []) if p.shared_document_hashes > 0]
        if not matches:
            return SignalOutcome(evaluable=True, weight=weight)
        related = [p.company_b if p.company_a == company_id else p.company_a for p in matches]
        total = sum(p.shared_document_hashes for p in matches)
        return SignalOutcome(
            evaluable=True,
            weight=weight,
            signal=RiskSignal(
                code="DUPLICATE_BID_DOCUMENTS",
                label="Identical bid documents submitted by different bidders",
                severity=1.0,
                weight=weight,
                description=(
                    f"Exactly matching uploaded bid document fingerprint(s) were found "
                    f"between this bidder and {len(related)} other bidder(s) on the same "
                    "procurement. This is a document-level review signal; shared "
                    "templates or authorised common preparation can have legitimate "
                    "explanations and must be verified."
                ),
                evidence={
                    "matching_document_fingerprints": total,
                    "peer_companies": [_display(pg, c) for c in related[:8]],
                },
                related_entities=related[:8],
            ),
        )

    def _complementary_bidding(
        self, company_id: str, row: Dict[str, float], data_flags: Dict[str, bool]
    ) -> SignalOutcome:
        weight = self.weights.complementary_bidding
        if not data_flags.get("has_bid_amounts"):
            return SignalOutcome(evaluable=False)
        ratio = float(row.get("complementary_bid_ratio", 0.0))
        if ratio < 0.6 or row.get("n_tenders", 0) < 3:
            return SignalOutcome(evaluable=True, weight=weight)

        return SignalOutcome(
            evaluable=True,
            weight=weight,
            signal=RiskSignal(
                code="COVER_BID_PATTERN",
                label="Losing bids cluster just above the winning price",
                severity=_ratio(ratio, 0.6, ceiling=1.0),
                weight=weight,
                description=(
                    f"In {ratio:.0%} of the tenders it lost, this company's bid landed "
                    f"in a narrow band "
                    f"({self.thresholds.complementary_bid_low:.0%}-"
                    f"{self.thresholds.complementary_bid_high:.0%}) above the winning "
                    "bid. Consistent near-miss pricing is the footprint of cover "
                    "bidding, though it can also reflect a shared market rate."
                ),
                evidence={
                    "complementary_loss_ratio": round(ratio, 3),
                    "tenders_entered": int(row.get("n_tenders", 0)),
                    "band": [
                        self.thresholds.complementary_bid_low,
                        self.thresholds.complementary_bid_high,
                    ],
                },
            ),
        )

    def _winner_rotation(
        self,
        company_id: str,
        pg: ProcurementGraph,
        bundle: FeatureBundle,
        row: Dict[str, float],
    ) -> SignalOutcome:
        weight = self.weights.winner_rotation
        community_id = bundle.communities.community_of(company_id)
        behaviour = (
            bundle.cluster_behaviour.get(community_id) if community_id is not None else None
        )
        if behaviour is None:
            return SignalOutcome(evaluable=False)
        if len(behaviour.tenders) < self.thresholds.min_rotation_tenders:
            return SignalOutcome(evaluable=True, weight=weight)

        entropy = behaviour.rotation_entropy
        capture = behaviour.capture_ratio
        # Rotation = the same small group takes turns winning nearly everything
        # they jointly enter.
        if (
            entropy < self.thresholds.rotation_entropy_min
            or capture < 0.85
            or len(behaviour.members) > 10
        ):
            return SignalOutcome(evaluable=True, weight=weight)

        wins = behaviour.winner_counts
        return SignalOutcome(
            evaluable=True,
            weight=weight,
            signal=RiskSignal(
                code="WINNER_ROTATION",
                label="Wins rotate evenly within a closed bidding group",
                severity=float(min(1.0, 0.5 * entropy + 0.5 * capture)),
                weight=weight,
                description=(
                    f"Belongs to a group of {len(behaviour.members)} firms that won "
                    f"{capture:.0%} of the {len(behaviour.tenders)} tenders they "
                    f"jointly entered, with wins spread unusually evenly "
                    f"(rotation index {entropy:.2f}). Even distribution of awards "
                    "within a closed group is a recognised bid-rotation pattern and "
                    "needs to be checked against capacity and specialisation."
                ),
                evidence={
                    "group_size": len(behaviour.members),
                    "joint_tenders": len(behaviour.tenders),
                    "group_capture_ratio": round(capture, 3),
                    "rotation_index": round(entropy, 3),
                    "wins_by_member": {
                        _display(pg, k): v for k, v in sorted(wins.items())
                    },
                },
                related_entities=[m for m in behaviour.members if m != company_id][:8],
            ),
        )

    def _market_concentration(
        self, company_id: str, row: Dict[str, float]
    ) -> SignalOutcome:
        weight = self.weights.market_concentration
        concentration = float(row.get("cluster_win_concentration", 0.0))
        dept = float(row.get("department_concentration", 0.0))
        if concentration < self.thresholds.max_cluster_win_concentration and dept < 0.9:
            return SignalOutcome(evaluable=True, weight=weight)
        if row.get("n_tenders", 0) < 3:
            return SignalOutcome(evaluable=True, weight=weight)

        return SignalOutcome(
            evaluable=True,
            weight=weight,
            signal=RiskSignal(
                code="MARKET_CONCENTRATION",
                label="Activity concentrated in one buyer or one winner",
                severity=float(min(1.0, max(concentration, dept))),
                weight=weight,
                description=(
                    f"{dept:.0%} of this company's bids go to a single procuring "
                    "department, and awards inside its bidding group are highly "
                    "concentrated. Concentration alone is not unusual for "
                    "specialists, so buyer relationships should be reviewed in "
                    "context."
                ),
                evidence={
                    "department_concentration": round(dept, 3),
                    "group_win_concentration": round(concentration, 3),
                    "tenders_entered": int(row.get("n_tenders", 0)),
                },
            ),
        )

    def _high_centrality(
        self, company_id: str, row: Dict[str, float], degree_cutoff: float
    ) -> SignalOutcome:
        weight = self.weights.high_centrality
        degree = float(row.get("degree_centrality", 0.0))
        if degree_cutoff <= 0 or degree < degree_cutoff:
            return SignalOutcome(evaluable=True, weight=weight)
        return SignalOutcome(
            evaluable=True,
            weight=weight,
            signal=RiskSignal(
                code="HIGH_CENTRALITY",
                label="Unusually central position in the procurement network",
                severity=0.5,
                weight=weight,
                description=(
                    "Sits in the top percentile of network connectivity, linking many "
                    "tenders, officers and addresses. Central firms are often simply "
                    "large incumbents; this is context for other signals rather than "
                    "a concern on its own."
                ),
                evidence={
                    "degree_centrality": round(degree, 4),
                    "percentile_cutoff": round(degree_cutoff, 4),
                    "betweenness": round(float(row.get("betweenness", 0.0)), 4),
                    "pagerank": round(float(row.get("pagerank", 0.0)), 5),
                },
            ),
        )

    def _dense_community(
        self, company_id: str, bundle: FeatureBundle, row: Dict[str, float]
    ) -> SignalOutcome:
        weight = self.weights.dense_community
        size = int(row.get("community_size", 0))
        density = float(row.get("community_density", 0.0))
        if size < self.thresholds.min_community_size or density < 0.75 or size > 12:
            return SignalOutcome(evaluable=True, weight=weight)
        community_id = bundle.communities.community_of(company_id)
        members = bundle.communities.members(community_id) if community_id is not None else []
        return SignalOutcome(
            evaluable=True,
            weight=weight,
            signal=RiskSignal(
                code="DENSE_SUBGROUP",
                label="Member of a small, densely interconnected bidder group",
                severity=float(min(1.0, density)),
                weight=weight,
                description=(
                    f"Belongs to a tightly connected community of {size} bidders "
                    f"(link density {density:.2f}) formed by shared tenders, officers "
                    "and addresses. Dense clusters concentrate the relationships an "
                    "investigator would want to map first."
                ),
                evidence={
                    "community_size": size,
                    "community_density": round(density, 3),
                    "community_id": community_id,
                },
                related_entities=[m for m in members if m != company_id][:8],
            ),
        )

    def _single_bidder(
        self, company_id: str, pg: ProcurementGraph, bundle: FeatureBundle
    ) -> SignalOutcome:
        weight = self.weights.single_bidder_tender
        tenders = sorted(pg.company_tenders.get(company_id, set()))
        if not tenders:
            return SignalOutcome(evaluable=False)
        solo_wins = [
            t
            for t in tenders
            if pg.tender_winner.get(t) == company_id
            and len(pg.tender_companies.get(t, set())) == 1
        ]
        if not solo_wins or len(solo_wins) < 2:
            return SignalOutcome(evaluable=True, weight=weight)
        ratio = len(solo_wins) / len(tenders)
        return SignalOutcome(
            evaluable=True,
            weight=weight,
            signal=RiskSignal(
                code="UNCONTESTED_AWARDS",
                label="Repeated awards with no competing bid",
                severity=float(min(1.0, 0.4 + ratio)),
                weight=weight,
                description=(
                    f"Won {len(solo_wins)} tenders in which it was the only recorded "
                    "bidder. Uncontested awards can reflect narrow specifications or "
                    "suppressed competition and are worth checking against the "
                    "tender notices."
                ),
                evidence={
                    "uncontested_wins": len(solo_wins),
                    "share_of_tenders": round(ratio, 3),
                    "tender_ids": [pg.node_display(t) for t in solo_wins[:8]],
                },
            ),
        )


# ------------------------------------------------------------------ tenders
def evaluate_tender_signals(
    tender_id: str,
    pg: ProcurementGraph,
    bundle: FeatureBundle,
    thresholds: FeatureThresholds,
) -> List[RiskSignal]:
    """Tender-level indicators, used by ``GET /tender/{id}``."""
    if tender_id not in bundle.tender_features.index:
        return []
    row = bundle.tender_features.loc[tender_id]
    signals: List[RiskSignal] = []

    bidders = sorted(pg.tender_companies.get(tender_id, set()))
    spread = row.get("bid_spread")
    if spread is not None and not pd.isna(spread) and len(bidders) > 1:
        if float(spread) <= thresholds.bid_similarity_pct * 2:
            signals.append(
                RiskSignal(
                    code="TIGHT_BID_CLUSTER",
                    label="All bids clustered in a narrow price band",
                    severity=float(min(1.0, 1.0 - float(spread) / max(1e-9, thresholds.bid_similarity_pct * 2))),
                    weight=1.0,
                    description=(
                        f"The {len(bidders)} bids received span only "
                        f"{float(spread):.2%}. Genuine competition usually produces a "
                        "wider spread; cost structures should be compared."
                    ),
                    evidence={"bid_spread": round(float(spread), 4), "n_bidders": len(bidders)},
                    related_entities=bidders,
                )
            )

    margin = row.get("mean_losing_margin")
    margin_std = row.get("losing_margin_std")
    if (
        margin is not None and not pd.isna(margin)
        and margin_std is not None and not pd.isna(margin_std)
        and thresholds.complementary_bid_low <= float(margin) <= thresholds.complementary_bid_high
        and float(margin_std) < 0.03
    ):
        signals.append(
            RiskSignal(
                code="UNIFORM_LOSING_MARGINS",
                label="Losing bids sit at a uniform mark-up above the winner",
                severity=0.8,
                weight=1.0,
                description=(
                    f"Losing bids average {float(margin):.2%} above the winning bid "
                    f"with very little variation (σ={float(margin_std):.3f}). "
                    "Such uniformity is consistent with coordinated cover bids and "
                    "should be reviewed alongside the bidders' cost sheets."
                ),
                evidence={
                    "mean_losing_margin": round(float(margin), 4),
                    "losing_margin_std": round(float(margin_std), 4),
                },
                related_entities=bidders,
            )
        )

    if bool(row.get("single_bidder", False)):
        signals.append(
            RiskSignal(
                code="SINGLE_BIDDER",
                label="Only one bid received",
                severity=0.6,
                weight=1.0,
                description=(
                    "This tender attracted a single bid. Recurrent single-bid "
                    "tenders in the same category can indicate restricted "
                    "specifications or deterred competition."
                ),
                evidence={"n_bidders": int(row.get("n_bidders", 0))},
                related_entities=bidders,
            )
        )

    winner_margin = row.get("winning_margin_vs_estimate")
    if winner_margin is not None and not pd.isna(winner_margin) and float(winner_margin) > -0.02:
        signals.append(
            RiskSignal(
                code="NO_PRICE_PRESSURE",
                label="Winning price at or above the published estimate",
                severity=0.5,
                weight=1.0,
                description=(
                    f"The winning bid came in {float(winner_margin):+.2%} against the "
                    "published estimate, showing little downward price pressure. "
                    "Compare with similar tenders before drawing conclusions."
                ),
                evidence={"winning_margin_vs_estimate": round(float(winner_margin), 4)},
                related_entities=bidders,
            )
        )

    signals.sort(key=lambda s: -s.contribution)
    return signals


def suspicious_relationship_signals(
    pairs: Sequence[PairFeature],
    pg: ProcurementGraph,
    thresholds: FeatureThresholds,
    limit: int = 50,
) -> List[Dict[str, object]]:
    """Rank company-to-company relationships that deserve a look."""
    scored: List[Tuple[float, Dict[str, object]]] = []
    for pair in pairs:
        reasons: List[str] = []
        score = 0.0
        if pair.shared_directors > 0:
            score += 0.35
            reasons.append(
                f"{pair.shared_directors} shared officer(s) on both companies"
            )
        if pair.shared_addresses > 0:
            score += 0.25
            reasons.append("registered at the same normalised address")
        if pair.shared_tenders >= thresholds.min_cobid_events:
            score += 0.2 + min(0.15, 0.02 * pair.shared_tenders)
            reasons.append(f"bid against each other in {pair.shared_tenders} tenders")
        if (
            pair.mean_price_gap is not None
            and pair.mean_price_gap <= thresholds.bid_similarity_pct
            and pair.shared_tenders >= 3
        ):
            score += 0.3
            reasons.append(
                f"average bid gap of only {pair.mean_price_gap:.2%} across shared tenders"
            )
        if pair.shared_document_hashes > 0:
            score += 0.45
            reasons.append(f"exact uploaded document match on {pair.shared_document_hashes} file(s)")
        if pair.alternating_wins >= 3:
            score += 0.2
            reasons.append(f"wins alternate between them {pair.alternating_wins} times")
        if not reasons:
            continue
        scored.append(
            (
                score,
                {
                    **pair.to_dict(),
                    "company_a_name": _display(pg, pair.company_a),
                    "company_b_name": _display(pg, pair.company_b),
                    "relationship_risk": round(float(min(1.0, score)), 3),
                    "reasons": reasons,
                    "assessment": (
                        "Relationship shows multiple overlapping indicators and "
                        "warrants human investigation."
                    ),
                },
            )
        )
    scored.sort(key=lambda item: -item[0])
    return [payload for _, payload in scored[:limit]]


def degree_cutoff(features: pd.DataFrame, percentile: float) -> float:
    if features.empty or "degree_centrality" not in features.columns:
        return 0.0
    return percentile_threshold(features["degree_centrality"].tolist(), percentile)


def data_availability_flags(pg: ProcurementGraph) -> Dict[str, bool]:
    """Which signal families the supplied data can actually support."""
    return {
        "has_person_data": any(pg.company_persons.values()),
        "has_address_data": any(pg.company_addresses.values()),
        "has_bid_amounts": any(
            bid.get("bid_amount") is not None for bid in pg.bids.values()
        ),
        "has_results": any(v is not None for v in pg.tender_winner.values()),
    }


def aggregate_signal_counts(
    signals_by_company: Dict[str, List[RiskSignal]]
) -> List[Dict[str, object]]:
    """Dataset-level rollup of which signals fired and how often."""
    counts: Dict[str, Dict[str, object]] = {}
    for signals in signals_by_company.values():
        for signal in signals:
            entry = counts.setdefault(
                signal.code,
                {
                    "code": signal.code,
                    "label": signal.label,
                    "companies_flagged": 0,
                    "mean_severity": 0.0,
                    "_total": 0.0,
                },
            )
            entry["companies_flagged"] = int(entry["companies_flagged"]) + 1
            entry["_total"] = float(entry["_total"]) + signal.severity
    output = []
    for entry in counts.values():
        flagged = int(entry["companies_flagged"])
        entry["mean_severity"] = round(float(entry.pop("_total")) / max(flagged, 1), 3)
        output.append(entry)
    output.sort(key=lambda e: (-int(e["companies_flagged"]), e["code"]))
    _ = np  # numpy kept available for downstream numeric tweaks
    return output
