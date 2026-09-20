"""Loading + validation of procurement data from CSV, JSON or in-memory dicts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence, Tuple

import pandas as pd
from pydantic import ValidationError

from ..exceptions import DataValidationError
from ..logging_utils import get_logger
from .schema import COLUMN_ALIASES, BidRecord, ValidationReport

LOGGER = get_logger("data.loader")

MAX_REPORTED_ERRORS = 25


def _canonical_columns(frame: pd.DataFrame) -> pd.DataFrame:
    renamed: Dict[str, str] = {}
    for column in frame.columns:
        key = str(column).strip().lower().replace(" ", "_").replace("-", "_")
        renamed[column] = COLUMN_ALIASES.get(key.replace("_", ""), COLUMN_ALIASES.get(key, key))
    return frame.rename(columns=renamed)


def records_from_dicts(rows: Iterable[Dict[str, Any]]) -> Tuple[List[BidRecord], ValidationReport]:
    """Validate raw dictionaries into :class:`BidRecord` objects.

    Invalid rows are dropped rather than aborting the run; the caller receives a
    :class:`ValidationReport` describing exactly what was rejected.
    """
    report = ValidationReport()
    valid: List[BidRecord] = []

    for index, row in enumerate(rows):
        report.total_rows += 1
        cleaned = {
            (COLUMN_ALIASES.get(str(k).strip().lower(), str(k).strip().lower())): v
            for k, v in row.items()
        }
        try:
            record = BidRecord.model_validate(cleaned)
        except ValidationError as exc:
            report.rejected_rows += 1
            if len(report.errors) < MAX_REPORTED_ERRORS:
                detail = "; ".join(
                    f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()
                )
                report.errors.append(f"row {index}: {detail}")
            continue
        valid.append(record)
        report.valid_rows += 1

    labelled = [r.label for r in valid if r.label is not None]
    report.has_labels = len(labelled) > 0
    report.label_positive = sum(1 for v in labelled if v == 1)
    report.label_negative = sum(1 for v in labelled if v == 0)

    if report.has_labels and (report.label_positive == 0 or report.label_negative == 0):
        report.warnings.append(
            "Labels are single-class; supervised training will be skipped in favour "
            "of unsupervised anomaly scoring."
        )
    if not any(r.bid_amount for r in valid):
        report.warnings.append(
            "No bid_amount values supplied - price-similarity and complementary "
            "bidding signals will be unavailable."
        )
    if not any(r.person_id or r.person_name for r in valid):
        report.warnings.append("No person data - shared-director signal unavailable.")
    if not any(r.address for r in valid):
        report.warnings.append("No address data - shared-address signal unavailable.")

    if not valid:
        raise DataValidationError(
            "No valid procurement rows could be parsed from the supplied input.",
            report.errors,
        )

    LOGGER.info(
        "validated %d/%d rows (%d rejected)",
        report.valid_rows,
        report.total_rows,
        report.rejected_rows,
    )
    return valid, report


def load_dataframe(frame: pd.DataFrame) -> Tuple[List[BidRecord], ValidationReport]:
    frame = _canonical_columns(frame)
    missing = {"company_id", "tender_id"} - set(frame.columns)
    if missing:
        raise DataValidationError(
            f"Input is missing required column(s): {', '.join(sorted(missing))}"
        )
    rows = frame.astype(object).where(pd.notna(frame), None).to_dict(orient="records")
    return records_from_dicts(rows)


def load_csv(path: str | Path) -> Tuple[List[BidRecord], ValidationReport]:
    file_path = Path(path)
    if not file_path.exists():
        raise DataValidationError(f"CSV file not found: {file_path}")
    try:
        frame = pd.read_csv(file_path)
    except Exception as exc:  # pragma: no cover - pandas raises many subtypes
        raise DataValidationError(f"Could not read CSV {file_path}: {exc}") from exc
    return load_dataframe(frame)


def load_json(path: str | Path) -> Tuple[List[BidRecord], ValidationReport]:
    file_path = Path(path)
    if not file_path.exists():
        raise DataValidationError(f"JSON file not found: {file_path}")
    try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise DataValidationError(f"Invalid JSON in {file_path}: {exc}") from exc

    if isinstance(payload, dict):
        for key in ("records", "data", "rows", "bids"):
            if key in payload and isinstance(payload[key], list):
                payload = payload[key]
                break
        else:
            raise DataValidationError(
                "JSON object must contain a 'records', 'data', 'rows' or 'bids' list."
            )
    if not isinstance(payload, list):
        raise DataValidationError("JSON payload must be a list of bid objects.")
    return records_from_dicts(payload)


def load_path(path: str | Path) -> Tuple[List[BidRecord], ValidationReport]:
    """Dispatch on file extension."""
    file_path = Path(path)
    suffix = file_path.suffix.lower()
    if suffix == ".csv":
        return load_csv(file_path)
    if suffix in (".json", ".jsonl"):
        return load_json(file_path)
    raise DataValidationError(f"Unsupported file type '{suffix}'. Use .csv or .json.")


def records_to_frame(records: Sequence[BidRecord]) -> pd.DataFrame:
    """Flatten validated records back into a DataFrame for feature work."""
    return pd.DataFrame(
        [
            {
                "company_id": r.company_id,
                "company_name": r.company_name,
                "person_id": r.person_id,
                "person_name": r.person_name,
                "tender_id": r.tender_id,
                "department_id": r.department_id,
                "department_name": r.department_name,
                "address": r.address,
                "bid_amount": r.bid_amount,
                "tender_value": r.tender_value,
                "bid_date": r.bid_date,
                "result": r.result,
                "is_winner": r.is_winner,
                "label": r.label,
            }
            for r in records
        ]
    )
