"""End-to-end orchestration: data in, explainable risk out.

    records -> validate -> normalise identities -> build graph -> graph features
            -> NetworkX community/relationship analysis -> PyG tensors
            -> GAT (supervised) or Isolation Forest (unsupervised)
            -> rule signals -> blended 0-100 score -> explanations
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import pandas as pd

from ..config import DISCLAIMER, Settings, load_settings
from ..data.loader import load_dataframe, load_path, records_from_dicts
from ..data.normalize import NormalizedDataset, normalize_records
from ..data.schema import BidRecord, ValidationReport
from ..exceptions import EntityNotFoundError, ModelNotTrainedError, ProcureShieldError
from ..features.graph_features import FeatureBundle, build_features
from ..graph.builder import (
    ProcurementGraph,
    build_graph,
    ego_network,
    export_edges,
    export_nodes,
)
from ..graph.store import GraphStore, build_store
from ..logging_utils import get_logger
from ..models.anomaly import score_anomalies
from ..models.gat import TORCH_AVAILABLE, describe_backend
from ..models.registry import ModelRegistry
from ..models.trainer import GATTrainer, TrainingResult
from .network_analysis import dense_bidding_groups
from .risk_signals import (
    RiskSignal,
    RiskSignalEngine,
    aggregate_signal_counts,
    data_availability_flags,
    degree_cutoff,
    evaluate_tender_signals,
    suspicious_relationship_signals,
)
from .scoring import (
    EntityRisk,
    build_overall_explanation,
    rank_entities,
    score_entity,
)

LOGGER = get_logger("analysis.pipeline")


@dataclass
class AnalysisResult:
    """Complete output of one ``/analyze`` run."""

    analysis_id: str
    created_at: str
    mode: str
    risk_score: float
    risk_level: str
    model_probability: Optional[float]
    explanation: str
    suspicious_entities: List[EntityRisk] = field(default_factory=list)
    all_entities: Dict[str, EntityRisk] = field(default_factory=dict)
    suspicious_relationships: List[Dict[str, Any]] = field(default_factory=list)
    risk_signals: List[Dict[str, Any]] = field(default_factory=list)
    graph_nodes: List[Dict[str, Any]] = field(default_factory=list)
    graph_edges: List[Dict[str, Any]] = field(default_factory=list)
    graph_stats: Dict[str, int] = field(default_factory=dict)
    dataset_summary: Dict[str, Any] = field(default_factory=dict)
    validation: Optional[ValidationReport] = None
    training: Optional[TrainingResult] = None
    tender_risk: Dict[str, float] = field(default_factory=dict)
    disclaimer: str = DISCLAIMER

    def to_response(
        self, max_entities: int = 50, include_all_entities: bool = False
    ) -> Dict[str, Any]:
        """Serialise into the documented ``/analyze`` response shape.

        ``include_all_entities`` adds every scored company, not just the ones
        at or above the alert threshold. Downstream clients that render a full
        portfolio need the low scores too, and asking for them here is
        preferable to distorting the alert threshold to force entities into
        ``suspicious_entities``.
        """
        payload: Dict[str, Any] = {
            "analysis_id": self.analysis_id,
            "created_at": self.created_at,
            "mode": self.mode,
            "risk_score": round(float(self.risk_score), 2),
            "risk_level": self.risk_level,
            "model_probability": (
                None if self.model_probability is None
                else round(float(self.model_probability), 4)
            ),
            "suspicious_entities": [
                e.to_dict() for e in self.suspicious_entities[:max_entities]
            ],
            "suspicious_relationships": self.suspicious_relationships,
            "risk_signals": self.risk_signals,
            "graph_nodes": self.graph_nodes,
            "graph_edges": self.graph_edges,
            "graph_stats": self.graph_stats,
            "dataset_summary": self.dataset_summary,
            "explanation": self.explanation,
            "validation": self.validation.model_dump() if self.validation else None,
            "training": self.training.to_dict() if self.training else None,
            "disclaimer": self.disclaimer,
        }
        if include_all_entities:
            payload["all_entities"] = [
                e.to_dict() for e in rank_entities(list(self.all_entities.values()))
            ]
        return payload


@dataclass
class AnalysisContext:
    """Intermediate artefacts kept for entity-level API endpoints."""

    graph: ProcurementGraph
    bundle: FeatureBundle
    dataset: NormalizedDataset
    result: AnalysisResult


class ProcureShieldPipeline:
    """Stateful facade over the whole engine."""

    def __init__(
        self,
        settings: Optional[Settings] = None,
        store: Optional[GraphStore] = None,
    ) -> None:
        self.settings = settings or load_settings()
        self.store: GraphStore = store or build_store(self.settings)
        self.registry = ModelRegistry(self.settings.model.artifact_dir)
        self.trainer: Optional[GATTrainer] = None
        self.context: Optional[AnalysisContext] = None
        self._counter = 0

    # ------------------------------------------------------------- ingestion
    def _ingest(
        self,
        records: Optional[Sequence[BidRecord]] = None,
        rows: Optional[Sequence[Dict[str, Any]]] = None,
        frame: Optional[pd.DataFrame] = None,
        path: Optional[str | Path] = None,
    ) -> Tuple[List[BidRecord], ValidationReport]:
        if records is not None:
            report = ValidationReport(
                total_rows=len(records),
                valid_rows=len(records),
                has_labels=any(r.label is not None for r in records),
                label_positive=sum(1 for r in records if r.label == 1),
                label_negative=sum(1 for r in records if r.label == 0),
            )
            return list(records), report
        if rows is not None:
            return records_from_dicts(rows)
        if frame is not None:
            return load_dataframe(frame)
        if path is not None:
            return load_path(path)
        raise ProcureShieldError("No input supplied to the pipeline.")

    # --------------------------------------------------------------- analyse
    def analyze(
        self,
        records: Optional[Sequence[BidRecord]] = None,
        rows: Optional[Sequence[Dict[str, Any]]] = None,
        frame: Optional[pd.DataFrame] = None,
        path: Optional[str | Path] = None,
        train: bool = False,
        use_model: bool = True,
        max_entities: int = 50,
    ) -> AnalysisResult:
        """Run the full pipeline and cache the context for entity lookups."""
        valid_records, report = self._ingest(records, rows, frame, path)
        dataset = normalize_records(valid_records)
        graph = build_graph(dataset)
        self.store.persist(graph)
        bundle = build_features(graph)

        mode = "rules_only"
        training: Optional[TrainingResult] = None
        probabilities: Dict[str, float] = {}

        if use_model:
            mode, training, probabilities = self._model_probabilities(
                graph, bundle, train=train, has_labels=bool(graph.labels)
            )

        entities = self._score_companies(graph, bundle, probabilities)
        tender_risk = self._score_tenders(graph, bundle, entities)

        ranked = rank_entities(list(entities.values()))
        suspicious = [
            e for e in ranked if e.risk_score >= self.settings.alert_threshold
        ]
        relationships = suspicious_relationship_signals(
            bundle.pair_features, graph, self.settings.thresholds
        )
        signal_rollup = aggregate_signal_counts(
            {e.entity_id: e.signals for e in ranked}
        )

        dataset_summary = {
            **dataset.summary(),
            "tenders": len(graph.tenders),
            "companies": len(graph.companies),
            "labelled_companies": len(graph.labels),
            "dense_bidding_groups": len(dense_bidding_groups(graph)),
            "data_availability": data_availability_flags(graph),
        }

        headline = ranked[0].risk_score if ranked else 0.0
        model_probabilities = [
            e.model_probability for e in ranked[:10] if e.model_probability is not None
        ]

        self._counter += 1
        result = AnalysisResult(
            analysis_id=f"analysis_{self._counter:04d}",
            created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            mode=mode,
            risk_score=headline,
            risk_level=self.settings.bands.level_for(headline),
            model_probability=(
                sum(model_probabilities) / len(model_probabilities)
                if model_probabilities else None
            ),
            explanation=build_overall_explanation(
                ranked, self.settings, dataset_summary, mode
            ),
            suspicious_entities=suspicious[:max_entities],
            all_entities={e.entity_id: e for e in ranked},
            suspicious_relationships=relationships,
            risk_signals=signal_rollup,
            graph_nodes=export_nodes(graph, self.settings.max_graph_export_nodes),
            graph_edges=export_edges(graph, self.settings.max_graph_export_edges),
            graph_stats=graph.stats(),
            dataset_summary=dataset_summary,
            validation=report,
            training=training,
            tender_risk=tender_risk,
        )
        self.context = AnalysisContext(
            graph=graph, bundle=bundle, dataset=dataset, result=result
        )
        LOGGER.info(
            "analysis %s complete: %d suspicious of %d companies (mode=%s)",
            result.analysis_id, len(suspicious), len(ranked), mode,
        )
        return result

    # ----------------------------------------------------------------- model
    def _model_probabilities(
        self,
        graph: ProcurementGraph,
        bundle: FeatureBundle,
        train: bool,
        has_labels: bool,
    ) -> Tuple[str, Optional[TrainingResult], Dict[str, float]]:
        """Supervised GAT when labels allow it, otherwise anomaly scoring."""
        matrix, company_ids = bundle.matrix()

        label_values = set(graph.labels.values())
        can_train = has_labels and len(label_values) > 1 and TORCH_AVAILABLE

        if can_train:
            try:
                from ..features.encoders import build_graph_tensors

                tensors = build_graph_tensors(graph, bundle, graph.labels)
                trainer = self.trainer
                if train or trainer is None or trainer.model is None:
                    trainer = GATTrainer(self.settings.model)
                    result = trainer.train(tensors)
                    self.trainer = trainer
                    self._persist_model(trainer, result, tensors.num_features)
                    return "supervised_gat", result, result.probabilities
                probabilities = trainer.predict(tensors)
                return "supervised_gat", None, probabilities
            except (ModelNotTrainedError, ProcureShieldError) as exc:
                LOGGER.warning("supervised path unavailable (%s); using anomaly mode", exc)

        anomaly = score_anomalies(
            matrix,
            company_ids,
            list(bundle.company_features.columns),
            self.settings.model,
        )
        return (
            "unsupervised_anomaly",
            anomaly.to_training_result(self.settings.model.seed),
            anomaly.scores,
        )

    def _persist_model(
        self, trainer: GATTrainer, result: TrainingResult, in_channels: int
    ) -> None:
        try:
            trainer.save(self.settings.model.artifact_dir)
            self.registry.write_manifest(
                mode=result.mode,
                in_channels=in_channels,
                decision_threshold=result.decision_threshold,
                metrics=result.metrics,
                seed=result.seed,
            )
        except Exception as exc:  # pragma: no cover - disk issues shouldn't kill a run
            LOGGER.warning("could not persist model artefacts: %s", exc)

    # ---------------------------------------------------------------- scoring
    def _score_companies(
        self,
        graph: ProcurementGraph,
        bundle: FeatureBundle,
        probabilities: Dict[str, float],
    ) -> Dict[str, EntityRisk]:
        engine = RiskSignalEngine(self.settings)
        cutoff = degree_cutoff(
            bundle.company_features, self.settings.thresholds.high_degree_percentile
        )
        flags = data_availability_flags(graph)

        pairs_by_company: Dict[str, List] = {}
        for pair in bundle.pair_features:
            pairs_by_company.setdefault(pair.company_a, []).append(pair)
            pairs_by_company.setdefault(pair.company_b, []).append(pair)

        entities: Dict[str, EntityRisk] = {}
        for company_id in graph.companies:
            signals, rule_score = engine.evaluate_company(
                company_id, graph, bundle, pairs_by_company, cutoff, flags
            )
            entities[company_id] = score_entity(
                entity_id=company_id,
                name=graph.node_display(company_id),
                entity_type="Company",
                rule_score=rule_score,
                signals=signals,
                settings=self.settings,
                model_probability=probabilities.get(company_id),
                aliases=list(graph.graph.nodes[company_id].get("aliases", [])),
            )
        return entities

    def _score_tenders(
        self,
        graph: ProcurementGraph,
        bundle: FeatureBundle,
        entities: Dict[str, EntityRisk],
    ) -> Dict[str, float]:
        """Tender risk = own signals blended with the risk of its bidders."""
        risk: Dict[str, float] = {}
        for tender_id in graph.tenders:
            signals = evaluate_tender_signals(
                tender_id, graph, bundle, self.settings.thresholds
            )
            own = (
                sum(s.contribution for s in signals) / max(len(signals), 1)
                if signals else 0.0
            )
            bidders = graph.tender_companies.get(tender_id, set())
            bidder_scores = [
                entities[b].risk_score / 100.0 for b in bidders if b in entities
            ]
            bidder_component = max(bidder_scores) if bidder_scores else 0.0
            risk[tender_id] = round(
                float(min(1.0, 0.55 * own + 0.45 * bidder_component) * 100.0), 2
            )
        return risk

    # ------------------------------------------------------------- lookups
    def require_context(self) -> AnalysisContext:
        if self.context is None:
            raise EntityNotFoundError(
                "No analysis has been run yet. POST /analyze first."
            )
        return self.context

    def resolve_company(self, company_id: str) -> str:
        """Accept either a raw feed id or a canonical graph id."""
        context = self.require_context()
        if context.graph.has_node(company_id):
            return company_id
        canonical = context.dataset.companies.resolve(company_id)
        if context.graph.has_node(canonical):
            return canonical
        for node_id, data in context.graph.graph.nodes(data=True):
            if str(data.get("display", "")).lower() == company_id.lower():
                return node_id
        raise EntityNotFoundError(f"Company '{company_id}' is not in the analysed graph.")

    def resolve_tender(self, tender_id: str) -> str:
        context = self.require_context()
        for candidate in (tender_id, f"T_{tender_id}"):
            if context.graph.has_node(candidate):
                return candidate
        raise EntityNotFoundError(f"Tender '{tender_id}' is not in the analysed graph.")

    def company_detail(self, company_id: str) -> Dict[str, Any]:
        context = self.require_context()
        node_id = self.resolve_company(company_id)
        entity = context.result.all_entities.get(node_id)
        if entity is None:
            raise EntityNotFoundError(f"No risk record for company '{company_id}'.")

        graph = context.graph
        tenders = sorted(graph.company_tenders.get(node_id, set()))
        wins = [t for t in tenders if graph.tender_winner.get(t) == node_id]
        features = context.bundle.company_row(node_id) or {}

        return {
            **entity.to_dict(),
            "tenders_entered": len(tenders),
            "tenders_won": len(wins),
            "win_rate": round(len(wins) / len(tenders), 3) if tenders else 0.0,
            "tender_ids": [graph.node_display(t) for t in tenders[:50]],
            "directors": [
                graph.node_display(p) for p in sorted(graph.company_persons.get(node_id, set()))
            ],
            "addresses": [
                graph.node_display(a) for a in sorted(graph.company_addresses.get(node_id, set()))
            ],
            "community_id": context.bundle.communities.community_of(node_id),
            "features": {k: round(float(v), 4) for k, v in features.items()},
            "disclaimer": DISCLAIMER,
        }

    def tender_detail(self, tender_id: str) -> Dict[str, Any]:
        context = self.require_context()
        node_id = self.resolve_tender(tender_id)
        graph = context.graph
        bundle = context.bundle

        signals = evaluate_tender_signals(
            node_id, graph, bundle, self.settings.thresholds
        )
        score = context.result.tender_risk.get(node_id, 0.0)
        bidders = sorted(graph.tender_companies.get(node_id, set()))
        winner = graph.tender_winner.get(node_id)
        row = (
            bundle.tender_features.loc[node_id].to_dict()
            if node_id in bundle.tender_features.index else {}
        )

        def _clean(value: Any) -> Any:
            if value is None or (isinstance(value, float) and pd.isna(value)):
                return None
            return round(float(value), 4) if isinstance(value, float) else value

        return {
            "tender_id": graph.node_display(node_id),
            "entity_type": "Tender",
            "risk_score": score,
            "risk_level": self.settings.bands.level_for(score),
            "department": (
                graph.node_display(graph.tender_department[node_id])
                if graph.tender_department.get(node_id) else None
            ),
            "winner": graph.node_display(winner) if winner else None,
            "bidders": [
                {
                    "company_id": b,
                    "name": graph.node_display(b),
                    "bid_amount": (graph.bids.get((b, node_id), {}) or {}).get("bid_amount"),
                    "is_winner": b == winner,
                    "company_risk_score": (
                        context.result.all_entities[b].risk_score
                        if b in context.result.all_entities else None
                    ),
                }
                for b in bidders
            ],
            "metrics": {k: _clean(v) for k, v in row.items()},
            "risk_signals": [s.to_dict() for s in signals],
            "explanation": (
                f"Tender {graph.node_display(node_id)} scores {score:.1f}/100 with "
                f"{len(signals)} tender-level indicator(s) across {len(bidders)} "
                "bidder(s). This reflects patterns requiring human investigation, "
                "not a finding of misconduct."
            ),
            "requires_human_investigation": score >= self.settings.alert_threshold,
            "disclaimer": DISCLAIMER,
        }

    def network(self, entity_id: str, depth: int = 2) -> Dict[str, Any]:
        context = self.require_context()
        node_id = entity_id
        if not context.graph.has_node(node_id):
            try:
                node_id = self.resolve_company(entity_id)
            except EntityNotFoundError:
                node_id = self.resolve_tender(entity_id)

        nodes, edges = ego_network(context.graph, node_id, depth=depth)
        for node in nodes:
            entity = context.result.all_entities.get(str(node["id"]))
            if entity is not None:
                node["risk_score"] = entity.risk_score
                node["risk_level"] = entity.risk_level
        return {
            "center": node_id,
            "center_label": context.graph.node_display(node_id),
            "depth": depth,
            "graph_nodes": nodes,
            "graph_edges": edges,
            "node_count": len(nodes),
            "edge_count": len(edges),
            "disclaimer": DISCLAIMER,
        }

    def alerts(
        self,
        min_score: Optional[float] = None,
        limit: int = 50,
        entity_type: str = "company",
    ) -> Dict[str, Any]:
        context = self.require_context()
        threshold = (
            self.settings.alert_threshold if min_score is None else float(min_score)
        )
        items: List[Dict[str, Any]] = []

        if entity_type in ("company", "all"):
            for entity in rank_entities(list(context.result.all_entities.values())):
                if entity.risk_score >= threshold:
                    items.append(
                        {
                            **entity.to_dict(include_signals=False),
                            "top_signals": [s.code for s in entity.signals[:4]],
                        }
                    )
        if entity_type in ("tender", "all"):
            for tender_id, score in sorted(
                context.result.tender_risk.items(), key=lambda kv: -kv[1]
            ):
                if score >= threshold:
                    items.append(
                        {
                            "entity_id": tender_id,
                            "entity_type": "Tender",
                            "name": context.graph.node_display(tender_id),
                            "risk_score": score,
                            "risk_level": self.settings.bands.level_for(score),
                            "requires_human_investigation": True,
                        }
                    )

        items.sort(key=lambda item: -float(item["risk_score"]))
        return {
            "threshold": threshold,
            "count": len(items),
            "alerts": items[:limit],
            "analysis_id": context.result.analysis_id,
            "disclaimer": DISCLAIMER,
        }

    # --------------------------------------------------------------- training
    def train(
        self,
        records: Optional[Sequence[BidRecord]] = None,
        rows: Optional[Sequence[Dict[str, Any]]] = None,
        frame: Optional[pd.DataFrame] = None,
        path: Optional[str | Path] = None,
        reuse_last: bool = False,
    ) -> TrainingResult:
        """Train (or retrain) the GAT and return metrics."""
        if reuse_last and self.context is not None:
            graph, bundle = self.context.graph, self.context.bundle
        else:
            valid_records, _ = self._ingest(records, rows, frame, path)
            dataset = normalize_records(valid_records)
            graph = build_graph(dataset)
            bundle = build_features(graph)
            self.store.persist(graph)

        if not graph.labels or len(set(graph.labels.values())) < 2:
            matrix, company_ids = bundle.matrix()
            anomaly = score_anomalies(
                matrix, company_ids, list(bundle.company_features.columns),
                self.settings.model,
            )
            return anomaly.to_training_result(self.settings.model.seed)

        if not TORCH_AVAILABLE:
            raise ModelNotTrainedError(
                "PyTorch is not installed; supervised training is unavailable. "
                "Install torch or run /analyze in unsupervised mode."
            )

        from ..features.encoders import build_graph_tensors

        tensors = build_graph_tensors(graph, bundle, graph.labels)
        trainer = GATTrainer(self.settings.model)
        result = trainer.train(tensors)
        self.trainer = trainer
        self._persist_model(trainer, result, tensors.num_features)
        return result

    # ------------------------------------------------------------------ misc
    def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "version": __import__("backend").__version__,
            "graph_backend": self.store.backend,
            "model": {
                **describe_backend(),
                "trained": self.trainer is not None and self.trainer.model is not None,
                "registry_has_artifacts": self.registry.exists(),
            },
            "last_analysis": (
                self.context.result.analysis_id if self.context else None
            ),
            "thresholds": {
                "alert_threshold": self.settings.alert_threshold,
                "rule_weight": self.settings.rule_weight,
                "model_weight": self.settings.model_weight,
            },
            "disclaimer": DISCLAIMER,
        }
