"""Shared fixtures. Synthetic data is generated once per session for speed."""

from __future__ import annotations

import pandas as pd
import pytest

from backend.analysis.pipeline import ProcureShieldPipeline
from backend.config import Settings
from backend.data.loader import load_dataframe
from backend.data.normalize import normalize_records
from backend.data.synthetic import SyntheticConfig, generate_synthetic_dataset
from backend.features.graph_features import build_features
from backend.graph.builder import build_graph


@pytest.fixture(scope="session")
def synthetic_frame() -> pd.DataFrame:
    return generate_synthetic_dataset(SyntheticConfig(seed=7))


@pytest.fixture(scope="session")
def small_frame() -> pd.DataFrame:
    return generate_synthetic_dataset(
        SyntheticConfig(
            seed=3,
            n_clean_companies=14,
            n_cartels=2,
            cartel_size=3,
            n_competitive_tenders=25,
            n_cartel_tenders_each=6,
        )
    )


@pytest.fixture(scope="session")
def records(synthetic_frame: pd.DataFrame):
    valid, _ = load_dataframe(synthetic_frame)
    return valid


@pytest.fixture(scope="session")
def dataset(records):
    return normalize_records(records)


@pytest.fixture(scope="session")
def graph(dataset):
    return build_graph(dataset)


@pytest.fixture(scope="session")
def bundle(graph):
    return build_features(graph)


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings()


@pytest.fixture(scope="session")
def analysed(small_frame, settings):
    pipeline = ProcureShieldPipeline(settings)
    result = pipeline.analyze(frame=small_frame, train=True)
    return pipeline, result
