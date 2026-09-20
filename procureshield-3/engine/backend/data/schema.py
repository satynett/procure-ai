"""Canonical input schema for procurement records.

A single input row is one *bid*: a company bidding in a tender. Person,
department and address columns are optional; the graph degrades gracefully when
they are absent.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

WIN_TOKENS = {"win", "won", "winner", "awarded", "award", "success", "1", "true", "yes"}
LOSS_TOKENS = {"lose", "lost", "loser", "rejected", "unsuccessful", "0", "false", "no"}

# Column aliases accepted from messy real-world exports.
COLUMN_ALIASES: Dict[str, str] = {
    "companyid": "company_id",
    "company": "company_name",
    "companyname": "company_name",
    "vendor_id": "company_id",
    "vendor_name": "company_name",
    "bidder_id": "company_id",
    "bidder_name": "company_name",
    "personid": "person_id",
    "director_id": "person_id",
    "director_name": "person_name",
    "personname": "person_name",
    "tenderid": "tender_id",
    "contract_id": "tender_id",
    "departmentid": "department_id",
    "dept_id": "department_id",
    "buyer_id": "department_id",
    "registered_address": "address",
    "company_address": "address",
    "bid": "bid_amount",
    "bid_value": "bid_amount",
    "amount": "bid_amount",
    "estimated_value": "tender_value",
    "tendervalue": "tender_value",
    "date": "bid_date",
    "biddate": "bid_date",
    "outcome": "result",
    "status": "result",
}


class BidRecord(BaseModel):
    """One validated bid row."""

    model_config = ConfigDict(extra="allow", str_strip_whitespace=True)

    company_id: str
    tender_id: str
    company_name: Optional[str] = None
    person_id: Optional[str] = None
    person_name: Optional[str] = None
    department_id: Optional[str] = None
    department_name: Optional[str] = None
    address: Optional[str] = None
    bid_amount: Optional[float] = Field(default=None, ge=0)
    tender_value: Optional[float] = Field(default=None, ge=0)
    bid_date: Optional[date] = None
    result: Optional[str] = None
    label: Optional[int] = Field(
        default=None,
        description="Optional supervision signal: 1 = previously flagged by "
        "investigators, 0 = reviewed and cleared. Never a verdict.",
    )

    @field_validator("company_id", "tender_id", mode="before")
    @classmethod
    def _require_identifier(cls, value: Any) -> str:
        if value is None or str(value).strip() in ("", "nan", "None", "NaN"):
            raise ValueError("identifier must be a non-empty value")
        return str(value).strip()

    @field_validator(
        "company_name",
        "person_id",
        "person_name",
        "department_id",
        "department_name",
        "address",
        "result",
        mode="before",
    )
    @classmethod
    def _blank_to_none(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        if text == "" or text.lower() in ("nan", "none", "null"):
            return None
        return text

    @field_validator("bid_amount", "tender_value", mode="before")
    @classmethod
    def _parse_money(cls, value: Any) -> Optional[float]:
        if value is None or value == "":
            return None
        if isinstance(value, (int, float)):
            number = float(value)
            return None if number != number else number  # drop NaN
        text = str(value).strip().replace(",", "").replace("$", "").replace("₹", "")
        if text == "" or text.lower() in ("nan", "none", "null"):
            return None
        try:
            return float(text)
        except ValueError as exc:  # pragma: no cover - defensive
            raise ValueError(f"could not parse monetary value {value!r}") from exc

    @field_validator("bid_date", mode="before")
    @classmethod
    def _parse_date(cls, value: Any) -> Optional[date]:
        if value is None or value == "":
            return None
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        text = str(value).strip()
        if text.lower() in ("nan", "none", "null", ""):
            return None
        for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d"):
            try:
                return datetime.strptime(text, fmt).date()
            except ValueError:
                continue
        try:
            return datetime.fromisoformat(text).date()
        except ValueError as exc:
            raise ValueError(f"unrecognised date format: {value!r}") from exc

    @field_validator("label", mode="before")
    @classmethod
    def _parse_label(cls, value: Any) -> Optional[int]:
        if value is None or value == "":
            return None
        if isinstance(value, float) and value != value:  # NaN
            return None
        if isinstance(value, (int, float)) and float(value) in (0.0, 1.0):
            return int(value)
        text = str(value).strip().lower()
        if text in ("nan", "none", "null"):
            return None
        if text in ("1", "1.0", "true", "yes", "flagged", "positive"):
            return 1
        if text in ("0", "0.0", "false", "no", "cleared", "negative"):
            return 0
        raise ValueError(f"label must be binary, got {value!r}")

    @model_validator(mode="after")
    def _check_consistency(self) -> "BidRecord":
        if self.bid_amount is not None and self.bid_amount <= 0:
            raise ValueError("bid_amount must be positive when supplied")
        return self

    @property
    def is_winner(self) -> bool:
        if self.result is None:
            return False
        return self.result.strip().lower() in WIN_TOKENS

    @property
    def is_known_loser(self) -> bool:
        if self.result is None:
            return False
        return self.result.strip().lower() in LOSS_TOKENS


class ValidationReport(BaseModel):
    """Summary of what survived validation - surfaced through the API."""

    total_rows: int = 0
    valid_rows: int = 0
    rejected_rows: int = 0
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    has_labels: bool = False
    label_positive: int = 0
    label_negative: int = 0

    @property
    def ok(self) -> bool:
        return self.valid_rows > 0
