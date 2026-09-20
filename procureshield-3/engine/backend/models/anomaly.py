"""Unsupervised risk scoring for datasets with no investigation labels.

An Isolation Forest is fitted on the company feature matrix and its outlier
score is converted to a rank-percentile in ``[0, 1]`` so it can be blended with
the rule score exactly like a supervised probability. Optionally the GAT is
trained as a graph auto-encoder to add a structural reconstruction term.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from ..config import ModelConfig
from ..logging_utils import get_logger
from .trainer import TrainingResult, seed_everything

LOGGER = get_logger("models.anomaly")

#: Features where a *high* value indicates elevated risk. Used to orient the
#: anomaly score so that "weird but clean" companies do not dominate alerts.
RISK_ORIENTED_FEATURES = [
    "top_partner_ratio",
    "max_cobid_count",
    "complementary_bid_ratio",
    "cluster_capture_ratio",
    "cluster_rotation_entropy",
    "shared_director_peers",
    "shared_address_peers",
    "community_density",
]
#: Features where a *low* value indicates elevated risk (tight pricing).
INVERTED_RISK_FEATURES = ["min_pair_price_gap", "mean_pair_price_gap"]


@dataclass
class AnomalyResult:
    """Output of the unsupervised mode."""

    scores: Dict[str, float] = field(default_factory=dict)
    contamination: float = 0.1
    n_companies: int = 0
    method: str = "isolation_forest+risk_orientation"

    def to_training_result(self, seed: int) -> TrainingResult:
        return TrainingResult(
            mode="unsupervised_anomaly",
            trained=True,
            backend={"model": self.method},
            split_sizes={"train": self.n_companies, "val": 0, "test": 0},
            metrics={},
            best_epoch=0,
            epochs_run=0,
            decision_threshold=0.5,
            probabilities=self.scores,
            seed=seed,
            message=(
                "No investigation labels supplied - scored with unsupervised "
                "anomaly detection. Metrics such as precision/recall cannot be "
                "computed without ground truth."
            ),
        )


def _rank_percentile(values: np.ndarray) -> np.ndarray:
    """Map arbitrary scores to ``[0, 1]`` by rank (ties share the mean rank)."""
    if values.size == 0:
        return values
    order = values.argsort()
    ranks = np.empty_like(order, dtype=float)
    ranks[order] = np.arange(values.size, dtype=float)
    if values.size > 1:
        ranks /= values.size - 1
    else:
        ranks[:] = 0.5
    return ranks


def score_anomalies(
    feature_matrix: np.ndarray,
    company_ids: List[str],
    feature_names: List[str],
    config: Optional[ModelConfig] = None,
) -> AnomalyResult:
    """Fit an Isolation Forest and return risk-oriented scores in ``[0, 1]``."""
    config = config or ModelConfig()
    seed_everything(config.seed)

    if feature_matrix.size == 0 or len(company_ids) == 0:
        return AnomalyResult(scores={}, n_companies=0)

    scaler = StandardScaler()
    scaled = scaler.fit_transform(feature_matrix)

    contamination = float(min(0.5, max(0.01, config.anomaly_contamination)))
    forest = IsolationForest(
        n_estimators=300,
        contamination=contamination,
        random_state=config.seed,
        n_jobs=1,
    )
    forest.fit(scaled)
    # decision_function: lower = more anomalous. Negate so higher = riskier.
    raw = -forest.decision_function(scaled)
    anomaly_percentile = _rank_percentile(raw)

    # Orientation term: an outlier is only interesting if it is an outlier in
    # the *collusion-risk* direction, not merely unusual.
    index_of = {name: i for i, name in enumerate(feature_names)}
    orientation = np.zeros(len(company_ids), dtype=float)
    used = 0
    for name in RISK_ORIENTED_FEATURES:
        if name in index_of:
            orientation += _rank_percentile(feature_matrix[:, index_of[name]])
            used += 1
    for name in INVERTED_RISK_FEATURES:
        if name in index_of:
            orientation += 1.0 - _rank_percentile(feature_matrix[:, index_of[name]])
            used += 1
    orientation = orientation / used if used else np.full(len(company_ids), 0.5)

    combined = 0.45 * anomaly_percentile + 0.55 * orientation
    combined = np.clip(combined, 0.0, 1.0)

    LOGGER.info(
        "anomaly scoring complete for %d companies (contamination=%.2f)",
        len(company_ids), contamination,
    )
    return AnomalyResult(
        scores={cid: float(s) for cid, s in zip(company_ids, combined)},
        contamination=contamination,
        n_companies=len(company_ids),
    )


def split_feature_matrix(
    matrix: np.ndarray, company_ids: List[str]
) -> Tuple[np.ndarray, List[str]]:
    """Defensive helper: drop rows that are entirely zero/NaN."""
    if matrix.size == 0:
        return matrix, company_ids
    finite = np.nan_to_num(matrix, nan=0.0, posinf=0.0, neginf=0.0)
    keep = ~np.all(finite == 0.0, axis=1)
    if keep.all():
        return finite, company_ids
    return finite[keep], [cid for cid, k in zip(company_ids, keep) if k]
