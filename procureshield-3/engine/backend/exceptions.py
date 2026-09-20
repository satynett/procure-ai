"""Typed exception hierarchy so the API can map failures to HTTP codes."""

from __future__ import annotations


class ProcureShieldError(Exception):
    """Base class for every error raised by the engine."""


class DataValidationError(ProcureShieldError):
    """Raised when input records cannot be parsed or fail validation."""

    def __init__(self, message: str, errors: list[str] | None = None) -> None:
        super().__init__(message)
        self.errors: list[str] = errors or []


class GraphBuildError(ProcureShieldError):
    """Raised when the procurement graph cannot be constructed."""


class ModelNotTrainedError(ProcureShieldError):
    """Raised when inference is requested before a model exists."""


class DependencyMissingError(ProcureShieldError):
    """Raised when an optional dependency (torch / PyG / neo4j) is unavailable."""


class EntityNotFoundError(ProcureShieldError):
    """Raised when a requested company/tender/node is not in the analysed graph."""
