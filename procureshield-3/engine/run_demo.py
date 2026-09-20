"""End-to-end ProcureShield demo on synthetic procurement data.

Run with::

    python run_demo.py                # full demo (rules + GAT)
    python run_demo.py --no-model     # rules-only, no PyTorch needed
    python run_demo.py --csv out.csv  # also write the synthetic dataset

The script never claims fraud. Every number below is a *risk indicator*
that a human investigator must review.
"""

from __future__ import annotations

import argparse
from typing import Any, Dict, List, Optional, Sequence

from backend.analysis.pipeline import AnalysisResult, ProcureShieldPipeline
from backend.config import DISCLAIMER, load_settings
from backend.data.synthetic import (
    SyntheticConfig,
    generate_synthetic_dataset,
    write_synthetic_dataset,
)
from backend.logging_utils import configure_logging


# --------------------------------------------------------------------- output
def rule(char: str = "=", width: int = 78) -> str:
    return char * width


def heading(title: str) -> None:
    print("\n" + rule())
    print(title)
    print(rule())


def table(rows: Sequence[Sequence[Any]], headers: Sequence[str]) -> None:
    """Print a minimal fixed-width table (no third-party dependency)."""
    cells = [[str(c) for c in row] for row in rows]
    widths = [len(h) for h in headers]
    for row in cells:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))
    line = "  ".join(h.ljust(widths[i]) for i, h in enumerate(headers))
    print(line)
    print("  ".join("-" * w for w in widths))
    for row in cells:
        print("  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)))


# ---------------------------------------------------------------- demo stages
def show_dataset(frame) -> None:
    heading("1. SYNTHETIC DATASET")
    labelled = frame["label"].notna().sum() if "label" in frame.columns else 0
    table(
        [
            ["rows", len(frame)],
            ["raw company ids", frame["company_id"].nunique()],
            ["tenders", frame["tender_id"].nunique()],
            ["departments", frame["department_id"].nunique()],
            ["labelled rows", int(labelled)],
        ],
        ["metric", "value"],
    )
    print("\nFirst rows:")
    print(frame.head(5).to_string(index=False))


def show_graph(result: AnalysisResult) -> None:
    heading("2. GRAPH + IDENTITY RESOLUTION")
    summary = result.dataset_summary
    table(
        [[k, v] for k, v in summary.items() if not isinstance(v, (dict, list))],
        ["dataset", "value"],
    )
    print()
    table([[k, v] for k, v in result.graph_stats.items()], ["graph", "count"])


def show_training(result: AnalysisResult) -> None:
    heading("3. MODEL")
    training = result.training
    if training is None:
        print("No model run for this analysis (rules-only mode).")
        return
    backend_name = training.backend.get("gat_backend", "unknown")
    table(
        [
            ["mode", training.mode],
            ["trained", training.trained],
            ["backend", backend_name],
            ["seed", training.seed],
            ["best epoch", training.best_epoch],
            ["epochs run", training.epochs_run],
            ["decision threshold", round(float(training.decision_threshold), 3)],
            ["split sizes", training.split_sizes],
        ],
        ["training", "value"],
    )
    if not training.metrics:
        print(f"\n{training.message}")
        return

    print("\nClassification metrics (disjoint splits, no leakage):")
    rows: List[List[Any]] = []
    for split in ("train", "validation", "val", "test"):
        metric = training.metrics.get(split)
        if not metric:
            continue
        rows.append(
            [
                split,
                metric.get("n"),
                metric.get("positives"),
                f"{float(metric.get('precision', 0.0)):.3f}",
                f"{float(metric.get('recall', 0.0)):.3f}",
                f"{float(metric.get('f1', 0.0)):.3f}",
                "n/a" if metric.get("roc_auc") is None
                else f"{float(metric['roc_auc']):.3f}",
            ]
        )
    table(rows, ["split", "n", "pos", "precision", "recall", "f1", "roc_auc"])
    print(
        "\nNote: these scores come from a deliberately clean synthetic generator.\n"
        "They are NOT an estimate of real-world performance."
    )


def show_risk(result: AnalysisResult, top: int = 10) -> None:
    heading("4. RISK ASSESSMENT")
    table(
        [
            ["headline risk score", f"{result.risk_score:.2f} / 100"],
            ["risk level", result.risk_level],
            ["mode", result.mode],
            [
                "model probability",
                "n/a" if result.model_probability is None
                else f"{result.model_probability:.4f}",
            ],
            ["entities above alert threshold", len(result.suspicious_entities)],
            ["suspicious relationships", len(result.suspicious_relationships)],
        ],
        ["headline", "value"],
    )

    print(f"\nTop {top} entities requiring human review:")
    rows = []
    for entity in result.suspicious_entities[:top]:
        rows.append(
            [
                entity.entity_id,
                entity.name[:28],
                f"{entity.risk_score:.1f}",
                entity.risk_level,
                "n/a" if entity.model_probability is None
                else f"{entity.model_probability:.3f}",
                ",".join(s.code for s in entity.signals[:3]) or "-",
            ]
        )
    if rows:
        table(rows, ["id", "name", "score", "level", "p(model)", "top signals"])
    else:
        print("No entity crossed the alert threshold.")


def show_explanations(result: AnalysisResult, top: int = 3) -> None:
    heading("5. EXPLANATIONS")
    print(result.explanation)
    for entity in result.suspicious_entities[:top]:
        print(f"\n--- {entity.entity_id} · {entity.name} "
              f"({entity.risk_score:.1f}, {entity.risk_level}) ---")
        print(entity.explanation)
        for signal in entity.signals[:4]:
            print(f"  - [{signal.code}] {signal.description}")
        for action in entity.recommended_actions[:3]:
            print(f"  > {action}")


def show_relationships(result: AnalysisResult, top: int = 5) -> None:
    heading("6. SUSPICIOUS RELATIONSHIPS")
    rows = []
    for rel in result.suspicious_relationships[:top]:
        rows.append(
            [
                str(rel.get("company_a_name", rel.get("company_a", "")))[:24],
                str(rel.get("company_b_name", rel.get("company_b", "")))[:24],
                rel.get("relationship_risk", "-"),
                "; ".join(rel.get("reasons", []))[:46],
            ]
        )
    if rows:
        table(rows, ["company A", "company B", "risk", "reasons"])
    else:
        print("No relationship crossed the reporting threshold.")


def show_alerts(pipeline: ProcureShieldPipeline, limit: int = 8) -> None:
    heading("7. /alerts VIEW (companies + tenders)")
    payload: Dict[str, Any] = pipeline.alerts(limit=limit, entity_type="all")
    print(f"threshold={payload['threshold']}  count={payload['count']}\n")
    rows = [
        [
            item["entity_id"],
            item["entity_type"],
            str(item.get("name", ""))[:28],
            f"{float(item['risk_score']):.1f}",
            item["risk_level"],
        ]
        for item in payload["alerts"]
    ]
    if rows:
        table(rows, ["id", "type", "name", "score", "level"])
    else:
        print("No alerts at the configured threshold.")


# ---------------------------------------------------------------------- entry
def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="ProcureShield Engine demo")
    parser.add_argument("--seed", type=int, default=7, help="synthetic data seed")
    parser.add_argument("--no-model", action="store_true",
                        help="skip the GNN and score with graph rules only")
    parser.add_argument("--csv", type=str, default=None,
                        help="also write the synthetic dataset to this CSV path")
    parser.add_argument("--top", type=int, default=10,
                        help="how many flagged entities to print")
    parser.add_argument("--verbose", action="store_true", help="show engine logs")
    args = parser.parse_args(argv)

    configure_logging("INFO" if args.verbose else "WARNING")

    config = SyntheticConfig(seed=args.seed)
    frame = generate_synthetic_dataset(config)
    show_dataset(frame)

    if args.csv:
        write_synthetic_dataset(args.csv, config)
        print(f"\nSynthetic dataset written to: {args.csv}")

    settings = load_settings()
    pipeline = ProcureShieldPipeline(settings=settings)

    result = pipeline.analyze(
        frame=frame,
        train=not args.no_model,
        use_model=not args.no_model,
        max_entities=args.top,
    )

    show_graph(result)
    show_training(result)
    show_risk(result, top=args.top)
    show_explanations(result)
    show_relationships(result)
    show_alerts(pipeline)

    heading("DISCLAIMER")
    print(DISCLAIMER)
    print(
        "\nNext: start the API with\n"
        "    uvicorn backend.main:app --reload\n"
        "then POST /analyze with {\"use_synthetic\": true, \"train\": true}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
