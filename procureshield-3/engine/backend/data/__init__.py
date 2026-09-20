"""Data ingestion, validation, normalisation and synthetic demo data."""

from .loader import load_csv, load_dataframe, load_json, load_path, records_from_dicts
from .normalize import NormalizedDataset, normalize_records
from .schema import BidRecord, ValidationReport
from .synthetic import SyntheticConfig, generate_synthetic_dataset

__all__ = [
    "BidRecord",
    "ValidationReport",
    "NormalizedDataset",
    "normalize_records",
    "load_csv",
    "load_json",
    "load_path",
    "load_dataframe",
    "records_from_dicts",
    "SyntheticConfig",
    "generate_synthetic_dataset",
]
