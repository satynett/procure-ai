"""Validation, parsing and identity-normalisation tests."""

from __future__ import annotations

import json

import pandas as pd
import pytest

from backend.data.loader import load_csv, load_json, load_path, records_from_dicts
from backend.data.normalize import (
    normalize_address,
    normalize_company_name,
    normalize_person_name,
    normalize_records,
)
from backend.data.schema import BidRecord
from backend.exceptions import DataValidationError


def test_minimal_record_parses():
    record = BidRecord.model_validate({"company_id": "C1", "tender_id": "T1"})
    assert record.company_id == "C1"
    assert record.bid_amount is None
    assert record.is_winner is False


def test_money_and_date_coercion():
    record = BidRecord.model_validate(
        {
            "company_id": "C1",
            "tender_id": "T1",
            "bid_amount": "1,250,000.50",
            "bid_date": "15/03/2024",
            "result": "Awarded",
        }
    )
    assert record.bid_amount == pytest.approx(1_250_000.50)
    assert record.bid_date.isoformat() == "2024-03-15"
    assert record.is_winner is True


def test_missing_identifier_is_rejected():
    with pytest.raises(Exception):
        BidRecord.model_validate({"company_id": "", "tender_id": "T1"})


def test_invalid_rows_are_reported_not_fatal():
    rows = [
        {"company_id": "C1", "tender_id": "T1"},
        {"company_id": None, "tender_id": "T2"},
        {"company_id": "C2", "tender_id": "T2", "bid_date": "not-a-date"},
    ]
    valid, report = records_from_dicts(rows)
    assert len(valid) == 1
    assert report.rejected_rows == 2
    assert report.total_rows == 3
    assert len(report.errors) == 2


def test_all_invalid_raises():
    with pytest.raises(DataValidationError):
        records_from_dicts([{"company_id": None, "tender_id": None}])


def test_column_aliases_are_accepted(tmp_path):
    frame = pd.DataFrame(
        [{"Vendor ID": "C1", "Contract_ID": "T1", "Bid Value": 100, "Outcome": "WIN"}]
    )
    path = tmp_path / "bids.csv"
    frame.to_csv(path, index=False)
    valid, report = load_csv(path)
    assert report.valid_rows == 1
    assert valid[0].company_id == "C1"
    assert valid[0].is_winner is True


def test_json_loading(tmp_path):
    path = tmp_path / "bids.json"
    path.write_text(
        json.dumps({"records": [{"company_id": "C1", "tender_id": "T1"}]}),
        encoding="utf-8",
    )
    valid, _ = load_json(path)
    assert len(valid) == 1
    assert load_path(path)[0][0].company_id == "C1"


def test_unsupported_file_type(tmp_path):
    path = tmp_path / "bids.txt"
    path.write_text("nope", encoding="utf-8")
    with pytest.raises(DataValidationError):
        load_path(path)


@pytest.mark.parametrize(
    "a,b",
    [
        ("ABC Infra Pvt. Ltd.", "A.B.C. INFRA PRIVATE LIMITED"),
        ("Shakti Buildcon LLP", "shakti  buildcon llp"),
    ],
)
def test_company_name_variants_collapse(a, b):
    assert normalize_company_name(a) == normalize_company_name(b)


def test_distinct_companies_do_not_collapse():
    assert normalize_company_name("Apex Infra") != normalize_company_name("Orion Infra")


def test_person_name_order_insensitive():
    assert normalize_person_name("Dr. Rahul Sharma") == normalize_person_name("Sharma Rahul")


def test_address_normalisation():
    assert normalize_address("12/A, MG Road, Bhilai") == normalize_address(
        "12 A  M.G. Rd., BHILAI"
    )


def test_normalisation_merges_alias_ids():
    rows = [
        {"company_id": "C1", "company_name": "Apex Infra Pvt Ltd", "tender_id": "T1"},
        {"company_id": "C1-B", "company_name": "APEX INFRA PRIVATE LIMITED", "tender_id": "T2"},
    ]
    valid, _ = records_from_dicts(rows)
    dataset = normalize_records(valid)
    assert len(dataset.companies.canonical_to_display) == 1
    assert len(dataset.companies.merged_groups) == 1


def test_synthetic_dataset_is_reproducible(synthetic_frame):
    from backend.data.synthetic import SyntheticConfig, generate_synthetic_dataset

    again = generate_synthetic_dataset(SyntheticConfig(seed=7))
    pd.testing.assert_frame_equal(synthetic_frame, again)
