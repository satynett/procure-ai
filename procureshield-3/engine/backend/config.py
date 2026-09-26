"""Central, override-able configuration for ProcureShield Engine.

Every threshold used by the risk engine lives here so that analysts can tune the
system without touching detection code. Values can be overridden via
environment variables prefixed with ``PROCURESHIELD_`` or by passing an explicit
:class:`Settings` instance into the pipeline.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, Literal

GraphBackend = Literal["memory", "neo4j"]

# Compliance language. The engine describes *risk*, never guilt.
DISCLAIMER = (
    "ProcureShield produces statistical risk indicators only. Scores do not "
    "establish wrongdoing of any kind. Every flagged entity requires "
    "independent human investigation before any action is taken."
)

# Words the engine must never emit about a specific entity.
PROHIBITED_VERDICT_TERMS = (
    "fraudulent",
    "fraudster",
    "guilty",
    "criminal",
    "convicted",
    "proven collusion",
    "confirmed cartel",
)


@dataclass(frozen=True)
class FeatureThresholds:
    """Thresholds that turn raw graph features into discrete risk signals."""

    # Identity overlap
    min_shared_directors: int = 1
    min_shared_address_peers: int = 1

    # Co-bidding
    min_cobid_events: int = 3
    high_cobid_ratio: float = 0.60  # share of a company's tenders spent with one peer

    # Pricing
    bid_similarity_pct: float = 0.03  # <=3% spread => suspiciously tight
    complementary_bid_low: float = 0.01
    complementary_bid_high: float = 0.12

    # Winner rotation
    min_rotation_tenders: int = 4
    rotation_entropy_min: float = 0.70  # normalised entropy of winners in a cluster
    max_cluster_win_concentration: float = 0.85

    # Structure
    high_degree_percentile: float = 0.95
    min_community_size: int = 3


@dataclass(frozen=True)
class ScoreWeights:
    """Relative contribution of each rule-based signal to the rule score."""

    shared_directors: float = 1.00
    shared_address: float = 0.85
    cobid_frequency: float = 0.95
    bid_price_similarity: float = 1.00
    duplicate_bid_documents: float = 1.20
    complementary_bidding: float = 0.90
    winner_rotation: float = 1.00
    market_concentration: float = 0.60
    high_centrality: float = 0.40
    dense_community: float = 0.70
    single_bidder_tender: float = 0.55

    def as_dict(self) -> Dict[str, float]:
        return asdict(self)


@dataclass(frozen=True)
class RiskBands:
    """Score boundaries (0-100) for human-readable risk levels."""

    low_max: float = 25.0
    medium_max: float = 50.0
    high_max: float = 75.0

    def level_for(self, score: float) -> str:
        if score < self.low_max:
            return "LOW"
        if score < self.medium_max:
            return "MEDIUM"
        if score < self.high_max:
            return "HIGH"
        return "CRITICAL"


@dataclass(frozen=True)
class ModelConfig:
    """GAT / training hyper-parameters. All training is seeded for reproducibility."""

    hidden_channels: int = 64
    heads: int = 4
    dropout: float = 0.3
    learning_rate: float = 5e-3
    weight_decay: float = 5e-4
    epochs: int = 200
    patience: int = 30
    seed: int = 42
    test_size: float = 0.25
    val_size: float = 0.15
    anomaly_contamination: float = 0.12
    artifact_dir: str = "artifacts"


@dataclass(frozen=True)
class Settings:
    """Top-level settings object handed to every component."""

    graph_backend: GraphBackend = "memory"
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "neo4j"
    neo4j_database: str = "neo4j"

    thresholds: FeatureThresholds = field(default_factory=FeatureThresholds)
    weights: ScoreWeights = field(default_factory=ScoreWeights)
    bands: RiskBands = field(default_factory=RiskBands)
    model: ModelConfig = field(default_factory=ModelConfig)

    # Blend between deterministic graph rules and the learned GNN probability.
    rule_weight: float = 0.6
    model_weight: float = 0.4

    # Reporting
    alert_threshold: float = 50.0
    max_graph_export_nodes: int = 750
    max_graph_export_edges: int = 2500
    log_level: str = "INFO"

    def blended(self, rule_score: float, model_probability: float | None) -> float:
        """Blend rule score (0-1) and model probability (0-1) into 0-100."""
        if model_probability is None:
            combined = rule_score
        else:
            total = self.rule_weight + self.model_weight
            combined = (
                self.rule_weight * rule_score + self.model_weight * model_probability
            ) / (total if total else 1.0)
        return round(float(max(0.0, min(1.0, combined)) * 100.0), 2)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def load_settings() -> Settings:
    """Build :class:`Settings` from environment variables with safe fallbacks."""
    backend = os.getenv("PROCURESHIELD_GRAPH_BACKEND", "memory").lower()
    if backend not in ("memory", "neo4j"):
        backend = "memory"

    model = ModelConfig(
        epochs=int(_env_float("PROCURESHIELD_EPOCHS", ModelConfig.epochs)),
        seed=int(_env_float("PROCURESHIELD_SEED", ModelConfig.seed)),
        artifact_dir=os.getenv("PROCURESHIELD_ARTIFACT_DIR", ModelConfig.artifact_dir),
    )

    return Settings(
        graph_backend=backend,  # type: ignore[arg-type]
        neo4j_uri=os.getenv("PROCURESHIELD_NEO4J_URI", Settings.neo4j_uri),
        neo4j_user=os.getenv("PROCURESHIELD_NEO4J_USER", Settings.neo4j_user),
        neo4j_password=os.getenv("PROCURESHIELD_NEO4J_PASSWORD", Settings.neo4j_password),
        model=model,
        rule_weight=_env_float("PROCURESHIELD_RULE_WEIGHT", 0.6),
        model_weight=_env_float("PROCURESHIELD_MODEL_WEIGHT", 0.4),
        alert_threshold=_env_float("PROCURESHIELD_ALERT_THRESHOLD", 50.0),
        log_level=os.getenv("PROCURESHIELD_LOG_LEVEL", "INFO"),
    )


SETTINGS = load_settings()
