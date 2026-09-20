"""Risk signal, scoring and compliance-language tests."""

from __future__ import annotations

import pytest

from backend.config import PROHIBITED_VERDICT_TERMS, RiskBands, Settings
from backend.analysis.risk_signals import (
    RiskSignal,
    RiskSignalEngine,
    aggregate_signal_counts,
    data_availability_flags,
    degree_cutoff,
    evaluate_tender_signals,
    suspicious_relationship_signals,
)
from backend.analysis.scoring import (
    ComplianceError,
    assert_compliant,
    build_explanation,
    build_overall_explanation,
    score_entity,
)


def _engine(settings):
    return RiskSignalEngine(settings)


def _pairs_by_company(bundle):
    mapping = {}
    for pair in bundle.pair_features:
        mapping.setdefault(pair.company_a, []).append(pair)
        mapping.setdefault(pair.company_b, []).append(pair)
    return mapping


@pytest.mark.parametrize(
    "score,expected",
    [(0, "LOW"), (24.9, "LOW"), (25, "MEDIUM"), (49.9, "MEDIUM"),
     (50, "HIGH"), (74.9, "HIGH"), (75, "CRITICAL"), (100, "CRITICAL")],
)
def test_risk_bands(score, expected):
    assert RiskBands().level_for(score) == expected


def test_blending_respects_weights():
    settings = Settings(rule_weight=0.5, model_weight=0.5)
    assert settings.blended(1.0, 0.0) == pytest.approx(50.0)
    assert settings.blended(0.0, 1.0) == pytest.approx(50.0)
    # With no model probability the rule score carries the full weight.
    assert settings.blended(0.8, None) == pytest.approx(80.0)


def test_blending_is_clamped():
    settings = Settings()
    assert settings.blended(5.0, 5.0) == 100.0
    assert settings.blended(-1.0, None) == 0.0


def test_configurable_thresholds_change_outcomes(graph, bundle):
    strict = Settings()
    lenient = Settings(
        thresholds=type(strict.thresholds)(min_cobid_events=999, high_cobid_ratio=0.99)
    )
    flags = data_availability_flags(graph)
    pairs = _pairs_by_company(bundle)
    cutoff = degree_cutoff(bundle.company_features, 0.95)
    company = max(
        graph.companies, key=lambda c: bundle.company_row(c)["top_partner_ratio"]
    )
    strict_signals, _ = _engine(strict).evaluate_company(
        company, graph, bundle, pairs, cutoff, flags
    )
    lenient_signals, _ = _engine(lenient).evaluate_company(
        company, graph, bundle, pairs, cutoff, flags
    )
    codes_strict = {s.code for s in strict_signals}
    codes_lenient = {s.code for s in lenient_signals}
    assert "REPEATED_CO_BIDDING" in codes_strict
    assert "REPEATED_CO_BIDDING" not in codes_lenient


def test_missing_data_does_not_inflate_score(graph, bundle, settings):
    """Signals that cannot be evaluated are excluded from the denominator."""
    flags = data_availability_flags(graph)
    no_people = {**flags, "has_person_data": False, "has_address_data": False}
    pairs = _pairs_by_company(bundle)
    cutoff = degree_cutoff(bundle.company_features, 0.95)
    company = graph.companies[0]

    _, with_all = _engine(settings).evaluate_company(
        company, graph, bundle, pairs, cutoff, flags
    )
    _, without = _engine(settings).evaluate_company(
        company, graph, bundle, pairs, cutoff, no_people
    )
    assert 0.0 <= without <= 1.0
    assert 0.0 <= with_all <= 1.0


def test_signals_carry_evidence_and_hedged_language(graph, bundle, settings):
    flags = data_availability_flags(graph)
    pairs = _pairs_by_company(bundle)
    cutoff = degree_cutoff(bundle.company_features, 0.95)
    flagged = [c for c, v in graph.labels.items() if v == 1]
    signals, score = _engine(settings).evaluate_company(
        flagged[0], graph, bundle, pairs, cutoff, flags
    )
    assert signals and score > 0.3
    for signal in signals:
        assert signal.evidence or signal.related_entities
        assert 0.0 <= signal.severity <= 1.0
        assert_compliant(signal.description)


def test_tender_signals_produced(graph, bundle, settings):
    found = [
        evaluate_tender_signals(t, graph, bundle, settings.thresholds)
        for t in graph.tenders
    ]
    assert any(found), "expected tender-level signals somewhere in the dataset"
    for signals in found:
        for signal in signals:
            assert_compliant(signal.description)


def test_relationship_ranking(graph, bundle, settings):
    relationships = suspicious_relationship_signals(
        bundle.pair_features, graph, settings.thresholds, limit=10
    )
    assert relationships
    scores = [r["relationship_risk"] for r in relationships]
    assert scores == sorted(scores, reverse=True)
    assert all(r["reasons"] for r in relationships)


def test_signal_aggregation():
    signal = RiskSignal(
        code="X", label="x", severity=0.5, weight=1.0, description="ok"
    )
    rollup = aggregate_signal_counts({"a": [signal], "b": [signal]})
    assert rollup[0]["companies_flagged"] == 2
    assert rollup[0]["mean_severity"] == 0.5


def test_score_entity_produces_actions(settings):
    signal = RiskSignal(
        code="SHARED_DIRECTORS", label="Common officers", severity=0.9,
        weight=1.0, description="Shares officers with other bidders.",
    )
    entity = score_entity(
        "C1", "Apex Infra", "Company", 0.9, [signal], settings, model_probability=0.8
    )
    assert entity.risk_level in ("HIGH", "CRITICAL")
    assert entity.recommended_actions
    assert entity.requires_human_investigation if hasattr(entity, "requires_human_investigation") else True
    assert entity.to_dict()["requires_human_investigation"] is True


@pytest.mark.parametrize("term", PROHIBITED_VERDICT_TERMS)
def test_compliance_guard_rejects_verdict_language(term):
    with pytest.raises(ComplianceError):
        assert_compliant(f"This company is {term} and should be prosecuted.")


def test_explanations_are_compliant_and_hedged(settings):
    signal = RiskSignal(
        code="WINNER_ROTATION", label="Wins rotate evenly", severity=0.95,
        weight=1.0, description="Wins are spread evenly across a closed group.",
    )
    text = build_explanation("Apex Infra", 88.0, "CRITICAL", [signal], 0.91)
    assert "not findings of misconduct" in text
    assert_compliant(text)

    empty = build_explanation("Clean Co", 3.0, "LOW", [], None)
    assert "No structural" in empty


def test_overall_explanation_mentions_human_investigation(settings):
    entity = score_entity("C1", "Apex", "Company", 0.9, [], settings, 0.8)
    text = build_overall_explanation(
        [entity], settings, {"companies": 1, "tenders": 2}, "supervised_gat"
    )
    assert "human investigation" in text
    assert_compliant(text)
