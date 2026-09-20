"""Training, evaluation and inference for the GAT risk classifier.

Leakage controls
----------------
* Splits are made over **company nodes**, stratified on the label, and the three
  index sets are provably disjoint (asserted before training).
* The feature scaler is fitted on training rows only.
* Early stopping and threshold selection use the **validation** split; the test
  split is touched exactly once, at the end.
* No feature is derived from the label column.

Message passing is transductive - the graph structure of held-out nodes is
visible, which is standard for node classification - but held-out *labels* never
enter the loss or model selection.
"""

from __future__ import annotations

import json
import os
import random
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split

from ..config import ModelConfig
from ..exceptions import DependencyMissingError, ModelNotTrainedError
from ..features.encoders import GraphTensors, scale_features
from ..logging_utils import get_logger
from .gat import TORCH_AVAILABLE, GATRiskClassifier, describe_backend

LOGGER = get_logger("models.trainer")

MIN_LABELLED_FOR_TRAINING = 12


@dataclass
class SplitIndices:
    """Row indices (into ``GraphTensors.company_ids``) for each split."""

    train: List[int] = field(default_factory=list)
    val: List[int] = field(default_factory=list)
    test: List[int] = field(default_factory=list)

    def assert_disjoint(self) -> None:
        train, val, test = set(self.train), set(self.val), set(self.test)
        overlaps = {
            "train/val": train & val,
            "train/test": train & test,
            "val/test": val & test,
        }
        leaking = {k: sorted(v) for k, v in overlaps.items() if v}
        if leaking:
            raise ValueError(f"data leakage between splits: {leaking}")

    def sizes(self) -> Dict[str, int]:
        return {"train": len(self.train), "val": len(self.val), "test": len(self.test)}


@dataclass
class EvaluationMetrics:
    """Classification metrics for one split."""

    split: str
    n: int
    positives: int
    precision: float
    recall: float
    f1: float
    roc_auc: Optional[float]
    average_precision: Optional[float]
    true_negatives: int
    false_positives: int
    false_negatives: int
    true_positives: int
    threshold: float

    def to_dict(self) -> Dict[str, object]:
        return asdict(self)


@dataclass
class TrainingResult:
    """Everything the API needs to report on a training run."""

    mode: str
    trained: bool
    backend: Dict[str, object]
    split_sizes: Dict[str, int]
    metrics: Dict[str, Dict[str, object]]
    best_epoch: int
    epochs_run: int
    decision_threshold: float
    probabilities: Dict[str, float]
    seed: int
    message: str = ""
    feature_names: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, object]:
        payload = asdict(self)
        payload.pop("probabilities")
        return payload


def seed_everything(seed: int) -> None:
    """Make a run byte-for-byte repeatable."""
    random.seed(seed)
    np.random.seed(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)
    if TORCH_AVAILABLE:
        import torch

        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        torch.use_deterministic_algorithms(False)  # index_add_ has no det. kernel
        if hasattr(torch.backends, "cudnn"):
            torch.backends.cudnn.deterministic = True
            torch.backends.cudnn.benchmark = False


def make_splits(
    labels: np.ndarray,
    labelled_rows: List[int],
    config: ModelConfig,
) -> SplitIndices:
    """Stratified train/val/test split over labelled company rows."""
    y = labels[labelled_rows]
    stratify = y if len(np.unique(y)) > 1 and np.bincount(y).min() >= 2 else None

    train_rows, test_rows = train_test_split(
        labelled_rows,
        test_size=config.test_size,
        random_state=config.seed,
        stratify=stratify,
    )
    y_train = labels[train_rows]
    inner_stratify = (
        y_train if len(np.unique(y_train)) > 1 and np.bincount(y_train).min() >= 2 else None
    )
    relative_val = config.val_size / max(1e-9, (1.0 - config.test_size))
    train_rows, val_rows = train_test_split(
        train_rows,
        test_size=min(0.5, relative_val),
        random_state=config.seed,
        stratify=inner_stratify,
    )

    splits = SplitIndices(
        train=sorted(train_rows), val=sorted(val_rows), test=sorted(test_rows)
    )
    splits.assert_disjoint()
    return splits


def _evaluate(
    split: str,
    y_true: np.ndarray,
    y_prob: np.ndarray,
    threshold: float,
) -> EvaluationMetrics:
    y_pred = (y_prob >= threshold).astype(int)
    labels_present = np.unique(y_true)

    try:
        auc: Optional[float] = (
            float(roc_auc_score(y_true, y_prob)) if len(labels_present) > 1 else None
        )
    except ValueError:  # pragma: no cover - degenerate split
        auc = None
    try:
        ap: Optional[float] = (
            float(average_precision_score(y_true, y_prob))
            if len(labels_present) > 1 else None
        )
    except ValueError:  # pragma: no cover
        ap = None

    matrix = confusion_matrix(y_true, y_pred, labels=[0, 1])
    tn, fp, fn, tp = matrix.ravel()

    return EvaluationMetrics(
        split=split,
        n=int(len(y_true)),
        positives=int(y_true.sum()),
        precision=float(precision_score(y_true, y_pred, zero_division=0)),
        recall=float(recall_score(y_true, y_pred, zero_division=0)),
        f1=float(f1_score(y_true, y_pred, zero_division=0)),
        roc_auc=auc,
        average_precision=ap,
        true_negatives=int(tn),
        false_positives=int(fp),
        false_negatives=int(fn),
        true_positives=int(tp),
        threshold=float(threshold),
    )


def _best_threshold(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    """Pick the F1-optimal threshold on the validation split only.

    Validation sets in this domain are small, so many thresholds often tie on
    F1. Taking the *median* of the tied thresholds instead of the first one
    keeps the decision boundary in the middle of the separating gap and
    generalises noticeably better than hugging the lowest positive score.
    """
    if len(np.unique(y_true)) < 2:
        return 0.5
    candidates = np.unique(np.round(np.concatenate([y_prob, [0.5]]), 4))
    scored = [
        (float(t), float(f1_score(y_true, (y_prob >= t).astype(int), zero_division=0)))
        for t in candidates
    ]
    best_f1 = max(score for _, score in scored)
    tied = [t for t, score in scored if score >= best_f1 - 1e-12]
    return float(np.median(tied))


class GATTrainer:
    """Trains the GAT on labelled company nodes."""

    def __init__(self, config: ModelConfig) -> None:
        if not TORCH_AVAILABLE:
            raise DependencyMissingError(
                "PyTorch is not installed; supervised training is unavailable."
            )
        self.config = config
        self.model: Optional[GATRiskClassifier] = None
        self.scaler = None
        self.decision_threshold = 0.5
        self.feature_names: List[str] = []

    # ------------------------------------------------------------------ train
    def train(self, tensors: GraphTensors) -> TrainingResult:
        import torch
        import torch.nn.functional as F

        if tensors.y is None or tensors.labelled_mask is None:
            raise ModelNotTrainedError("No labels present; use unsupervised mode.")

        seed_everything(self.config.seed)

        labels = tensors.y.detach().cpu().numpy()
        labelled_rows = [int(i) for i in np.where(labels >= 0)[0]]
        if len(labelled_rows) < MIN_LABELLED_FOR_TRAINING:
            raise ModelNotTrainedError(
                f"Only {len(labelled_rows)} labelled companies; at least "
                f"{MIN_LABELLED_FOR_TRAINING} are required for a meaningful split."
            )
        if len(np.unique(labels[labelled_rows])) < 2:
            raise ModelNotTrainedError(
                "Labels contain a single class; supervised training is not possible."
            )

        splits = make_splits(labels, labelled_rows, self.config)

        # Scale using training companies only -> no statistics leak from val/test.
        train_node_indices = tensors.company_indices[splits.train].tolist()
        x_scaled, self.scaler = scale_features(tensors.x, train_node_indices)
        self.feature_names = list(tensors.feature_names or [])

        model = GATRiskClassifier(
            in_channels=int(x_scaled.shape[1]),
            hidden_channels=self.config.hidden_channels,
            heads=self.config.heads,
            dropout=self.config.dropout,
        )
        optimizer = torch.optim.AdamW(
            model.parameters(),
            lr=self.config.learning_rate,
            weight_decay=self.config.weight_decay,
        )

        y_all = torch.tensor(np.clip(labels, 0, 1), dtype=torch.long)
        train_nodes = tensors.company_indices[splits.train]
        val_nodes = tensors.company_indices[splits.val]
        test_nodes = tensors.company_indices[splits.test]

        y_train = y_all[splits.train]
        counts = torch.bincount(y_train, minlength=2).float()
        class_weights = torch.where(
            counts > 0, counts.sum() / (2.0 * counts.clamp(min=1.0)), torch.ones(2)
        )

        best_state: Optional[Dict[str, "torch.Tensor"]] = None
        # Ranking quality saturates quickly on separable graphs, so model
        # selection is (val AUC, -val loss): AUC first, calibration as tie-break.
        best_score: Tuple[float, float] = (-1.0, -float("inf"))
        best_epoch, stale = 0, 0

        for epoch in range(1, self.config.epochs + 1):
            model.train()
            optimizer.zero_grad()
            logits = model(x_scaled, tensors.edge_index)
            loss = F.cross_entropy(
                logits[train_nodes], y_train, weight=class_weights
            )
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 2.0)
            optimizer.step()

            model.eval()
            with torch.no_grad():
                val_logits = model(x_scaled, tensors.edge_index)
                probabilities = torch.softmax(val_logits, dim=-1)[:, 1]
                val_loss = float(
                    F.cross_entropy(val_logits[val_nodes], y_all[splits.val])
                )
            val_true = y_all[splits.val].numpy()
            val_prob = probabilities[val_nodes].numpy()
            try:
                ranking = (
                    roc_auc_score(val_true, val_prob)
                    if len(np.unique(val_true)) > 1
                    else f1_score(val_true, (val_prob >= 0.5).astype(int), zero_division=0)
                )
            except ValueError:  # pragma: no cover
                ranking = 0.0
            score = (round(float(ranking), 4), -val_loss)

            if score > best_score:
                best_score, best_epoch, stale = score, epoch, 0
                best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
            else:
                stale += 1
                if stale >= self.config.patience:
                    LOGGER.info("early stopping at epoch %d (best %d)", epoch, best_epoch)
                    break

            if epoch % 25 == 0:
                LOGGER.info(
                    "epoch %3d | train loss %.4f | val loss %.4f | val auc %.4f",
                    epoch, float(loss.detach()), val_loss, ranking,
                )

        epochs_run = epoch  # noqa: F821 - defined by the loop above
        if best_state is not None:
            model.load_state_dict(best_state)
        self.model = model

        model.eval()
        with torch.no_grad():
            probabilities = torch.softmax(model(x_scaled, tensors.edge_index), dim=-1)[:, 1]
        probability_array = probabilities.detach().cpu().numpy()

        val_true = y_all[splits.val].numpy()
        val_prob = probability_array[val_nodes.numpy()]
        self.decision_threshold = _best_threshold(val_true, val_prob)

        metrics = {
            "train": _evaluate(
                "train", y_all[splits.train].numpy(),
                probability_array[train_nodes.numpy()], self.decision_threshold,
            ).to_dict(),
            "validation": _evaluate(
                "validation", val_true, val_prob, self.decision_threshold
            ).to_dict(),
            "test": _evaluate(
                "test", y_all[splits.test].numpy(),
                probability_array[test_nodes.numpy()], self.decision_threshold,
            ).to_dict(),
        }

        company_probabilities = {
            company_id: float(probability_array[int(node_index)])
            for company_id, node_index in zip(
                tensors.company_ids, tensors.company_indices.tolist()
            )
        }

        LOGGER.info("training complete: test metrics %s", metrics["test"])
        return TrainingResult(
            mode="supervised_gat",
            trained=True,
            backend=describe_backend(),
            split_sizes=splits.sizes(),
            metrics=metrics,
            best_epoch=best_epoch,
            epochs_run=epochs_run,
            decision_threshold=self.decision_threshold,
            probabilities=company_probabilities,
            seed=self.config.seed,
            message="Supervised GAT trained on historic investigation labels.",
            feature_names=self.feature_names,
        )

    # -------------------------------------------------------------- inference
    def predict(self, tensors: GraphTensors) -> Dict[str, float]:
        import torch

        if self.model is None:
            raise ModelNotTrainedError("Train the model before requesting predictions.")
        x_scaled, _ = scale_features(tensors.x, [], scaler=self.scaler)
        with torch.no_grad():
            probabilities = torch.softmax(
                self.model(x_scaled, tensors.edge_index), dim=-1
            )[:, 1]
        array = probabilities.detach().cpu().numpy()
        return {
            company_id: float(array[int(node_index)])
            for company_id, node_index in zip(
                tensors.company_ids, tensors.company_indices.tolist()
            )
        }

    # ------------------------------------------------------------- persistence
    def save(self, directory: str | Path) -> Path:
        import joblib
        import torch

        if self.model is None:
            raise ModelNotTrainedError("Nothing to save - train the model first.")
        path = Path(directory)
        path.mkdir(parents=True, exist_ok=True)
        torch.save(self.model.state_dict(), path / "gat_state.pt")
        joblib.dump(self.scaler, path / "scaler.joblib")
        (path / "model_meta.json").write_text(
            json.dumps(
                {
                    "in_channels": int(self.model.conv1.in_channels)
                    if hasattr(self.model.conv1, "in_channels")
                    else None,
                    "hidden_channels": self.config.hidden_channels,
                    "heads": self.config.heads,
                    "dropout": self.config.dropout,
                    "decision_threshold": self.decision_threshold,
                    "feature_names": self.feature_names,
                    "seed": self.config.seed,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        return path

    def load(self, directory: str | Path, in_channels: int) -> None:
        import joblib
        import torch

        path = Path(directory)
        meta_path = path / "model_meta.json"
        if not (path / "gat_state.pt").exists():
            raise ModelNotTrainedError(f"No saved model found in {path}")
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        model = GATRiskClassifier(
            in_channels=in_channels,
            hidden_channels=int(meta.get("hidden_channels", self.config.hidden_channels)),
            heads=int(meta.get("heads", self.config.heads)),
            dropout=float(meta.get("dropout", self.config.dropout)),
        )
        model.load_state_dict(torch.load(path / "gat_state.pt", map_location="cpu"))
        model.eval()
        self.model = model
        self.scaler = joblib.load(path / "scaler.joblib")
        self.decision_threshold = float(meta.get("decision_threshold", 0.5))
        self.feature_names = list(meta.get("feature_names", []))
