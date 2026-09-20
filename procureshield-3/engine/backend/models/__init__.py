"""Learned components: GAT classifier, trainer, unsupervised fallback."""

from .anomaly import AnomalyResult, score_anomalies
from .gat import GATRiskClassifier, backend_name, describe_backend
from .registry import ModelRegistry
from .trainer import (
    EvaluationMetrics,
    GATTrainer,
    SplitIndices,
    TrainingResult,
    make_splits,
    seed_everything,
)

__all__ = [
    "GATRiskClassifier",
    "GATTrainer",
    "TrainingResult",
    "EvaluationMetrics",
    "SplitIndices",
    "make_splits",
    "seed_everything",
    "AnomalyResult",
    "score_anomalies",
    "ModelRegistry",
    "backend_name",
    "describe_backend",
]
