"""Clip-analysis endpoints (ADR-013). Kept apart from internal_routes.py so the
per-frame /internal/frames path is untouched."""
from __future__ import annotations

from fastapi import APIRouter

from app.metrics.catalog import build_catalog

router = APIRouter(prefix="/internal", tags=["internal"])


@router.get("/metrics/catalog")
def metrics_catalog() -> dict:
    return build_catalog()
