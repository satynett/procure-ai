"""Pydantic request/response models for the public API."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DataSource(BaseModel):
    """How a request supplies procurement data.

    Exactly one of ``records``, ``file_path`` or ``use_synthetic`` must be given.
    """

    model_config = ConfigDict(extra="forbid")

    records: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description="Inline bid rows. Each row needs at least company_id and tender_id.",
    )
    file_path: Optional[str] = Field(
        default=None, description="Server-side path to a .csv or .json file."
    )
    use_synthetic: bool = Field(
        default=False, description="Generate the built-in synthetic demo dataset."
    )
    synthetic_seed: int = Field(default=7, ge=0, description="Seed for synthetic data.")

    @model_validator(mode="after")
    def _exactly_one_source(self) -> "DataSource":
        supplied = [
            self.records is not None,
            bool(self.file_path),
            self.use_synthetic,
        ]
        if sum(supplied) != 1:
            raise ValueError(
                "Provide exactly one of: records, file_path, use_synthetic=true."
            )
        if self.records is not None and len(self.records) == 0:
            raise ValueError("records must not be empty.")
        return self


class AnalyzeRequest(DataSource):
    """``POST /analyze`` body."""

    train: bool = Field(
        default=False,
        description="Retrain the GAT on this dataset before scoring (labels required).",
    )
    use_model: bool = Field(
        default=True,
        description="Blend model output into the score. False = deterministic rules only.",
    )
    max_entities: int = Field(
        default=50, ge=1, le=500, description="Cap on returned suspicious entities."
    )
    alert_threshold: Optional[float] = Field(
        default=None, ge=0, le=100,
        description="Override the score at or above which an entity is 'suspicious'.",
    )
    rule_weight: Optional[float] = Field(default=None, ge=0, le=1)
    model_weight: Optional[float] = Field(default=None, ge=0, le=1)
    include_all_entities: bool = Field(
        default=False,
        description="Also return every scored company, not just flagged ones.",
    )


class TrainRequest(DataSource):
    """``POST /train`` body."""

    model_config = ConfigDict(extra="forbid")

    reuse_last_analysis: bool = Field(
        default=False,
        description="Train on the graph from the most recent /analyze run.",
    )
    epochs: Optional[int] = Field(default=None, ge=1, le=5000)
    seed: Optional[int] = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _allow_reuse_without_source(self) -> "TrainRequest":
        return self

    @classmethod
    def model_validate_lenient(cls, payload: Dict[str, Any]) -> "TrainRequest":
        """Allow an empty body when ``reuse_last_analysis`` is set."""
        if payload.get("reuse_last_analysis") and not any(
            payload.get(k) for k in ("records", "file_path", "use_synthetic")
        ):
            payload = {**payload, "use_synthetic": False}
            obj = cls.model_construct(**payload)
            return obj
        return cls.model_validate(payload)


class RiskSignalOut(BaseModel):
    code: str
    label: str
    severity: float
    weight: float
    description: str
    evidence: Dict[str, Any] = Field(default_factory=dict)
    related_entities: List[str] = Field(default_factory=list)


class SuspiciousEntityOut(BaseModel):
    entity_id: str
    entity_type: str
    name: str
    risk_score: float
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    risk_status: str
    rule_score: float
    model_probability: Optional[float]
    explanation: str
    recommended_actions: List[str] = Field(default_factory=list)
    requires_human_investigation: bool
    risk_signals: List[RiskSignalOut] = Field(default_factory=list)
    aliases: List[str] = Field(default_factory=list)


class AnalyzeResponse(BaseModel):
    """Documented shape of ``POST /analyze``."""

    analysis_id: str
    created_at: str
    mode: str
    risk_score: float = Field(description="Highest entity risk score in the dataset, 0-100.")
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    model_probability: Optional[float]
    suspicious_entities: List[SuspiciousEntityOut]
    all_entities: Optional[List[SuspiciousEntityOut]] = None
    suspicious_relationships: List[Dict[str, Any]]
    risk_signals: List[Dict[str, Any]]
    graph_nodes: List[Dict[str, Any]]
    graph_edges: List[Dict[str, Any]]
    graph_stats: Dict[str, Any]
    dataset_summary: Dict[str, Any]
    explanation: str
    validation: Optional[Dict[str, Any]] = None
    training: Optional[Dict[str, Any]] = None
    disclaimer: str


class TrainResponse(BaseModel):
    mode: str
    trained: bool
    backend: Dict[str, Any]
    split_sizes: Dict[str, int]
    metrics: Dict[str, Any]
    best_epoch: int
    epochs_run: int
    decision_threshold: float
    seed: int
    message: str
    feature_names: List[str] = Field(default_factory=list)
    disclaimer: str


class HealthResponse(BaseModel):
    status: str
    version: str
    graph_backend: str
    model: Dict[str, Any]
    last_analysis: Optional[str]
    thresholds: Dict[str, Any]
    disclaimer: str


class ErrorResponse(BaseModel):
    error: str
    detail: str
    errors: List[str] = Field(default_factory=list)
