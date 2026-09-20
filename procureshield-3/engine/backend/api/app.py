"""FastAPI application exposing the ProcureShield Engine."""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

from fastapi import Body, Depends, FastAPI, HTTPException, Path, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from ..config import DISCLAIMER, Settings
from ..data.synthetic import SyntheticConfig, generate_synthetic_dataset
from ..exceptions import (
    DataValidationError,
    DependencyMissingError,
    EntityNotFoundError,
    GraphBuildError,
    ModelNotTrainedError,
    ProcureShieldError,
)
from ..logging_utils import configure_logging, get_logger
from ..intelligence import check_eligibility, decode_upload, extract_pdf, extract_requirements, validate_document
from .dependencies import get_pipeline, get_settings
from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    ErrorResponse,
    HealthResponse,
    TrainRequest,
    TrainResponse,
)

LOGGER = get_logger("api")

DESCRIPTION = """
Graph-based **risk analytics** for public procurement.

ProcureShield surfaces structural and behavioural patterns associated with
bid rigging - shared officers, shared addresses, repeat co-bidding, tight bid
pricing, cover bids and winner rotation - and combines them with a Graph
Attention Network into an explainable 0-100 risk score.

**The engine never determines that an entity has done anything wrong.** Every
output is an indicator of risk that requires independent human investigation.
"""


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    """Application factory (used by uvicorn and by the test suite)."""
    configure_logging((settings.log_level if settings else "INFO"))

    app = FastAPI(
        title="ProcureShield Engine",
        version=__import__("backend").__version__,
        description=DESCRIPTION,
        responses={
            400: {"model": ErrorResponse},
            404: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
        },
    )
    if settings is not None:
        app.state.settings = settings

    # ----------------------------------------------------------------- CORS
    # The engine normally sits behind the Node BFF, which is same-origin with
    # the browser, so no CORS is needed. Set PROCURESHIELD_CORS_ORIGINS (comma
    # separated, or "*") to let a browser call the engine directly.
    origins = [
        o.strip()
        for o in os.getenv("PROCURESHIELD_CORS_ORIGINS", "").split(",")
        if o.strip()
    ]
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # ------------------------------------------------------- error handling
    @app.exception_handler(DataValidationError)
    async def _validation_handler(_: Request, exc: DataValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={"error": "invalid_data", "detail": str(exc), "errors": exc.errors[:25]},
        )

    @app.exception_handler(EntityNotFoundError)
    async def _not_found_handler(_: Request, exc: EntityNotFoundError) -> JSONResponse:
        return JSONResponse(
            status_code=404, content={"error": "not_found", "detail": str(exc), "errors": []}
        )

    @app.exception_handler(ModelNotTrainedError)
    async def _model_handler(_: Request, exc: ModelNotTrainedError) -> JSONResponse:
        return JSONResponse(
            status_code=409,
            content={"error": "model_not_trained", "detail": str(exc), "errors": []},
        )

    @app.exception_handler(DependencyMissingError)
    async def _dependency_handler(_: Request, exc: DependencyMissingError) -> JSONResponse:
        return JSONResponse(
            status_code=503,
            content={"error": "dependency_missing", "detail": str(exc), "errors": []},
        )

    @app.exception_handler(GraphBuildError)
    async def _graph_handler(_: Request, exc: GraphBuildError) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={"error": "graph_build_failed", "detail": str(exc), "errors": []},
        )

    @app.exception_handler(ProcureShieldError)
    async def _generic_handler(_: Request, exc: ProcureShieldError) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={"error": "engine_error", "detail": str(exc), "errors": []},
        )

    # -------------------------------------------------------------- routes
    @app.get("/health", response_model=HealthResponse, tags=["system"])
    def health(pipeline=Depends(get_pipeline)) -> Dict[str, Any]:
        """Liveness plus a snapshot of engine state and active thresholds."""
        return pipeline.health()

    @app.post("/analyze", response_model=AnalyzeResponse, tags=["analysis"])
    def analyze(
        request: AnalyzeRequest = Body(...),
        pipeline=Depends(get_pipeline),
    ) -> Dict[str, Any]:
        """Run the full detection pipeline and return explainable risk output."""
        _apply_overrides(pipeline, request.alert_threshold, request.rule_weight,
                         request.model_weight)
        kwargs = _source_kwargs(request)
        result = pipeline.analyze(
            train=request.train,
            use_model=request.use_model,
            max_entities=request.max_entities,
            **kwargs,
        )
        return result.to_response(
            max_entities=request.max_entities,
            include_all_entities=request.include_all_entities,
        )

    @app.post("/train", response_model=TrainResponse, tags=["analysis"])
    def train(
        request: Dict[str, Any] = Body(default_factory=dict),
        pipeline=Depends(get_pipeline),
    ) -> Dict[str, Any]:
        """Train (or retrain) the GAT and return precision/recall/F1/ROC-AUC."""
        payload = dict(request or {})
        reuse = bool(payload.get("reuse_last_analysis"))
        if reuse:
            payload.setdefault("use_synthetic", False)
            parsed = TrainRequest.model_construct(**payload)
        else:
            parsed = TrainRequest.model_validate(payload)

        if parsed.epochs is not None or parsed.seed is not None:
            _apply_model_overrides(pipeline, parsed.epochs, parsed.seed)

        kwargs = {} if reuse else _source_kwargs(parsed)
        result = pipeline.train(reuse_last=reuse, **kwargs)
        return {**result.to_dict(), "disclaimer": DISCLAIMER}

    @app.get("/company/{company_id}", tags=["entities"])
    def company(
        company_id: str = Path(..., description="Canonical or raw company id, or name."),
        pipeline=Depends(get_pipeline),
    ) -> Dict[str, Any]:
        """Risk profile, signals and network context for one company."""
        return pipeline.company_detail(company_id)

    @app.get("/tender/{tender_id}", tags=["entities"])
    def tender(
        tender_id: str = Path(..., description="Tender id as supplied in the feed."),
        pipeline=Depends(get_pipeline),
    ) -> Dict[str, Any]:
        """Competition metrics and tender-level risk indicators."""
        return pipeline.tender_detail(tender_id)

    @app.get("/lookup/tender", tags=["entities"])
    def tender_by_query(
        tender_id: str = Query(..., description="Tender id, including any '/' characters."),
        pipeline=Depends(get_pipeline),
    ) -> Dict[str, Any]:
        """Same payload as ``/tender/{id}``, for ids that contain slashes.

        Real procurement references (e.g. ``GEM/2026/T/002001``) cannot be
        carried in a path segment: the slashes survive URL-encoding and split
        the route. Callers with such ids use this query-parameter form.
        """
        return pipeline.tender_detail(tender_id)

    @app.get("/lookup/company", tags=["entities"])
    def company_by_query(
        company_id: str = Query(..., description="Company id, including any '/' characters."),
        pipeline=Depends(get_pipeline),
    ) -> Dict[str, Any]:
        """Same payload as ``/company/{id}``, for ids that contain slashes."""
        return pipeline.company_detail(company_id)

    @app.get("/network/{entity_id}", tags=["entities"])
    def network(
        entity_id: str = Path(..., description="Company or tender id at the centre."),
        depth: int = Query(2, ge=1, le=4, description="Hops to traverse."),
        pipeline=Depends(get_pipeline),
    ) -> Dict[str, Any]:
        """Ego network around an entity, annotated with risk scores."""
        return pipeline.network(entity_id, depth=depth)

    @app.get("/alerts", tags=["analysis"])
    def alerts(
        min_score: Optional[float] = Query(None, ge=0, le=100),
        limit: int = Query(50, ge=1, le=500),
        entity_type: str = Query("company", pattern="^(company|tender|all)$"),
        pipeline=Depends(get_pipeline),
    ) -> Dict[str, Any]:
        """Entities from the latest analysis at or above the alert threshold."""
        return pipeline.alerts(min_score=min_score, limit=limit, entity_type=entity_type)

    @app.post("/intelligence/pdf", tags=["document-intelligence"])
    def intelligence_pdf(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
        """Extract text from an uploaded PDF supplied as base64."""
        try:
            data = decode_upload(payload)
            result = extract_pdf(data, str(payload.get("filename", "document.pdf")))
            result["requirements"] = extract_requirements(result.get("text", ""))
            return result
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.post("/intelligence/requirements", tags=["document-intelligence"])
    def intelligence_requirements(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
        return extract_requirements(str(payload.get("text", "")))

    @app.post("/intelligence/validate-document", tags=["document-intelligence"])
    def intelligence_validate(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
        try:
            data = decode_upload(payload)
            return validate_document(str(payload.get("filename", "document.pdf")), payload.get("content_type"), data)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.post("/intelligence/eligibility", tags=["document-intelligence"])
    def intelligence_eligibility(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
        tender = payload.get("tender") or {}
        bidder = payload.get("bidder") or {}
        return check_eligibility(tender, bidder)

    @app.get("/demo/dataset", tags=["system"])
    def demo_dataset(
        rows: int = Query(25, ge=1, le=500),
        seed: int = Query(7, ge=0),
    ) -> Dict[str, Any]:
        """Preview the built-in synthetic dataset (useful for smoke tests)."""
        frame = generate_synthetic_dataset(SyntheticConfig(seed=seed))
        return {
            "total_rows": int(len(frame)),
            "columns": list(frame.columns),
            "rows": frame.head(rows).to_dict(orient="records"),
            "disclaimer": DISCLAIMER,
        }

    return app


def _source_kwargs(request: Any) -> Dict[str, Any]:
    """Translate a :class:`DataSource` into pipeline keyword arguments."""
    if getattr(request, "use_synthetic", False):
        return {
            "frame": generate_synthetic_dataset(
                SyntheticConfig(seed=getattr(request, "synthetic_seed", 7))
            )
        }
    if getattr(request, "records", None):
        return {"rows": request.records}
    if getattr(request, "file_path", None):
        return {"path": request.file_path}
    raise HTTPException(
        status_code=400,
        detail="Provide records, file_path, or use_synthetic=true.",
    )


def _apply_overrides(
    pipeline,
    alert_threshold: Optional[float],
    rule_weight: Optional[float],
    model_weight: Optional[float],
) -> None:
    """Per-request threshold overrides, applied immutably to the settings."""
    from dataclasses import replace

    updates: Dict[str, Any] = {}
    if alert_threshold is not None:
        updates["alert_threshold"] = alert_threshold
    if rule_weight is not None:
        updates["rule_weight"] = rule_weight
    if model_weight is not None:
        updates["model_weight"] = model_weight
    if updates:
        pipeline.settings = replace(pipeline.settings, **updates)


def _apply_model_overrides(
    pipeline, epochs: Optional[int], seed: Optional[int]
) -> None:
    from dataclasses import replace

    updates: Dict[str, Any] = {}
    if epochs is not None:
        updates["epochs"] = epochs
    if seed is not None:
        updates["seed"] = seed
    if updates:
        pipeline.settings = replace(
            pipeline.settings, model=replace(pipeline.settings.model, **updates)
        )


app = create_app()

__all__ = ["app", "create_app", "get_settings"]
