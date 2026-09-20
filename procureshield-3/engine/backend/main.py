"""Uvicorn entry point: `uvicorn backend.main:app --reload`."""

from __future__ import annotations

from .api.app import create_app
from .config import load_settings

settings = load_settings()
app = create_app(settings)
