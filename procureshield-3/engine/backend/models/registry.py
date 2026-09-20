"""On-disk registry for trained artefacts, so /train survives a restart."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from ..logging_utils import get_logger

LOGGER = get_logger("models.registry")

MANIFEST = "manifest.json"


@dataclass
class ModelManifest:
    """Metadata describing the currently registered model."""

    mode: str
    created_at: str
    in_channels: int
    decision_threshold: float
    metrics: Dict[str, Any]
    seed: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "mode": self.mode,
            "created_at": self.created_at,
            "in_channels": self.in_channels,
            "decision_threshold": self.decision_threshold,
            "metrics": self.metrics,
            "seed": self.seed,
        }


class ModelRegistry:
    """Thin filesystem registry (one active model per directory)."""

    def __init__(self, directory: str | Path) -> None:
        self.directory = Path(directory)

    @property
    def manifest_path(self) -> Path:
        return self.directory / MANIFEST

    def exists(self) -> bool:
        return self.manifest_path.exists() and (self.directory / "gat_state.pt").exists()

    def write_manifest(
        self,
        mode: str,
        in_channels: int,
        decision_threshold: float,
        metrics: Dict[str, Any],
        seed: int,
    ) -> ModelManifest:
        self.directory.mkdir(parents=True, exist_ok=True)
        manifest = ModelManifest(
            mode=mode,
            created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            in_channels=in_channels,
            decision_threshold=decision_threshold,
            metrics=metrics,
            seed=seed,
        )
        self.manifest_path.write_text(
            json.dumps(manifest.to_dict(), indent=2), encoding="utf-8"
        )
        LOGGER.info("model manifest written to %s", self.manifest_path)
        return manifest

    def read_manifest(self) -> Optional[ModelManifest]:
        if not self.manifest_path.exists():
            return None
        try:
            payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:  # pragma: no cover - corrupted artefact
            LOGGER.warning("corrupt manifest at %s", self.manifest_path)
            return None
        return ModelManifest(**payload)
