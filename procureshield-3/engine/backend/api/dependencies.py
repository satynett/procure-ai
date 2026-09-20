"""Shared application state and FastAPI dependencies.

The pipeline is a process-level singleton: it caches the most recent analysis so
that ``/company``, ``/tender``, ``/network`` and ``/alerts`` can answer without
recomputing the graph. ``reset_pipeline`` exists so tests get a clean instance.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Optional

from ..analysis.pipeline import ProcureShieldPipeline
from ..config import Settings, load_settings
from ..logging_utils import configure_logging

_PIPELINE: Optional[ProcureShieldPipeline] = None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = load_settings()
    configure_logging(settings.log_level)
    return settings


def get_pipeline() -> ProcureShieldPipeline:
    """FastAPI dependency returning the shared pipeline instance."""
    global _PIPELINE
    if _PIPELINE is None:
        _PIPELINE = ProcureShieldPipeline(get_settings())
    return _PIPELINE


def reset_pipeline(settings: Optional[Settings] = None) -> ProcureShieldPipeline:
    """Replace the singleton - used by tests and by CLI entry points."""
    global _PIPELINE
    _PIPELINE = ProcureShieldPipeline(settings or get_settings())
    return _PIPELINE
