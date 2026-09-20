"""Combining rule signals with model output into an explainable 0-100 score."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from ..config import PROHIBITED_VERDICT_TERMS, Settings
from ..logging_utils import get_logger
from .risk_signals import RiskSignal

LOGGER = get_logger("analysis.scoring")

#: Wording used everywhere an entity is described. Never a verdict.
RISK_LANGUAGE = {
    "LOW": "low risk",
    "MEDIUM": "medium risk - monitor",
    "HIGH": "high risk - review recommended",
    "CRITICAL": "high risk - priority review recommended",
}

RECOMMENDED_ACTIONS = {
    "SHARED_DIRECTORS": "Pull corporate registry filings for the named officers.",
    "SHARED_ADDRESS": "Verify the registered premises and tenancy records.",
    "REPEATED_CO_BIDDING": "Compare bid documents for shared formatting or metadata.",
    "BID_PRICE_SIMILARITY": "Request the underlying cost breakdowns for both bidders.",
    "COVER_BID_PATTERN": "Review the losing bids for token or non-responsive content.",
    "WINNER_ROTATION": "Chart award history across the group and check capacity claims.",
    "MARKET_CONCENTRATION": "Interview the procuring department on supplier selection.",
    "HIGH_CENTRALITY": "Map the entity's full relationship network before prioritising.",
    "DENSE_SUBGROUP": "Treat the cluster as one case file rather than separate entities.",
    "UNCONTESTED_AWARDS": "Check whether tender specifications were unduly restrictive.",
    "TIGHT_BID_CLUSTER": "Compare unit rates line by line across the received bids.",
    "UNIFORM_LOSING_MARGINS": "Examine whether losing bids were prepared independently.",
    "SINGLE_BIDDER": "Review publication reach and qualification criteria.",
    "NO_PRICE_PRESSURE": "Benchmark the award price against comparable contracts.",
}


class ComplianceError(RuntimeError):
    """Raised when generated text would assert wrongdoing."""


def assert_compliant(text: str) -> str:
    """Guard: no output may accuse an entity of an offence.

    Called on every generated explanation. Raising here is deliberate - silently
    rewriting would hide a regression in the wording templates.
    """
    lowered = text.lower()
    for term in PROHIBITED_VERDICT_TERMS:
        if re.search(rf"\b{re.escape(term)}\b", lowered):
            raise ComplianceError(
                f"Generated text contains prohibited verdict language: {term!r}"
            )
    return text


@dataclass
class EntityRisk:
    """Scored entity, ready for API serialisation."""

    entity_id: str
    entity_type: str
    name: str
    risk_score: float
    risk_level: str
    rule_score: float
    model_probability: Optional[float]
    signals: List[RiskSignal] = field(default_factory=list)
    explanation: str = ""
    recommended_actions: List[str] = field(default_factory=list)
    aliases: List[str] = field(default_factory=list)

    def to_dict(self, include_signals: bool = True) -> Dict[str, object]:
        payload: Dict[str, object] = {
            "entity_id": self.entity_id,
            "entity_type": self.entity_type,
            "name": self.name,
            "risk_score": round(float(self.risk_score), 2),
            "risk_level": self.risk_level,
            "risk_status": RISK_LANGUAGE.get(self.risk_level, "risk assessed"),
            "rule_score": round(float(self.rule_score), 4),
            "model_probability": (
                None if self.model_probability is None
                else round(float(self.model_probability), 4)
            ),
            "explanation": self.explanation,
            "recommended_actions": self.recommended_actions,
            "requires_human_investigation": self.risk_score >= 50.0,
        }
        if self.aliases:
            payload["aliases"] = self.aliases
        if include_signals:
            payload["risk_signals"] = [s.to_dict() for s in self.signals]
        return payload


def score_entity(
    entity_id: str,
    name: str,
    entity_type: str,
    rule_score: float,
    signals: List[RiskSignal],
    settings: Settings,
    model_probability: Optional[float] = None,
    aliases: Optional[List[str]] = None,
) -> EntityRisk:
    """Blend rule and model evidence, then attach an explanation."""
    score = settings.blended(rule_score, model_probability)
    level = settings.bands.level_for(score)
    explanation = build_explanation(name, score, level, signals, model_probability)
    actions = [
        RECOMMENDED_ACTIONS[s.code] for s in signals if s.code in RECOMMENDED_ACTIONS
    ]
    if score >= settings.alert_threshold:
        actions.append(
            "Escalate to a human investigator; do not act on this score alone."
        )
    return EntityRisk(
        entity_id=entity_id,
        entity_type=entity_type,
        name=name,
        risk_score=score,
        risk_level=level,
        rule_score=rule_score,
        model_probability=model_probability,
        signals=signals,
        explanation=explanation,
        recommended_actions=list(dict.fromkeys(actions)),
        aliases=aliases or [],
    )


def build_explanation(
    name: str,
    score: float,
    level: str,
    signals: List[RiskSignal],
    model_probability: Optional[float],
) -> str:
    """Plain-language rationale for a score, in compliance-safe wording."""
    if not signals:
        body = (
            f"{name} scores {score:.1f}/100 ({RISK_LANGUAGE[level]}). No structural "
            "or behavioural risk indicators were triggered on the supplied data."
        )
        return assert_compliant(body)

    top = signals[: min(4, len(signals))]
    bullets = "; ".join(f"{s.label.lower()} ({s.severity:.2f})" for s in top)
    model_part = (
        f" The graph neural network assigns a {model_probability:.0%} risk "
        "propensity based on the surrounding network structure."
        if model_probability is not None
        else " No model probability was available, so the score is rule-driven only."
    )
    body = (
        f"{name} is assessed at {score:.1f}/100 ({RISK_LANGUAGE[level]}) because "
        f"{len(signals)} indicator(s) triggered: {bullets}.{model_part} "
        "These are statistical patterns, not findings of misconduct, and each one "
        "has an innocent explanation that investigators must rule out first."
    )
    return assert_compliant(body)


def build_overall_explanation(
    entities: List[EntityRisk],
    settings: Settings,
    dataset_summary: Dict[str, object],
    mode: str,
) -> str:
    """Narrative for the whole ``/analyze`` response."""
    flagged = [e for e in entities if e.risk_score >= settings.alert_threshold]
    top = sorted(entities, key=lambda e: -e.risk_score)[:3]
    top_text = (
        ", ".join(f"{e.name} ({e.risk_score:.0f})" for e in top) if top else "none"
    )
    mode_text = {
        "supervised_gat": "a trained graph attention network blended with graph rules",
        "unsupervised_anomaly": "unsupervised anomaly detection blended with graph rules",
        "rules_only": "deterministic graph rules only",
    }.get(mode, mode)

    body = (
        f"Analysed {dataset_summary.get('companies', 0)} companies across "
        f"{dataset_summary.get('tenders', 0)} tenders using {mode_text}. "
        f"{len(flagged)} compan{'y' if len(flagged) == 1 else 'ies'} scored at or "
        f"above the alert threshold of {settings.alert_threshold:.0f}. "
        f"Highest-scoring entities: {top_text}. "
        "Every score is an indication of risk requiring human investigation; "
        "no entity has been determined to have done anything wrong."
    )
    return assert_compliant(body)


def rank_entities(entities: List[EntityRisk]) -> List[EntityRisk]:
    return sorted(entities, key=lambda e: (-e.risk_score, e.name))
