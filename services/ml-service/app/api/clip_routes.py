"""Clip-analysis endpoints (ADR-013). Kept apart from internal_routes.py so the
per-frame /internal/frames path is untouched."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.clips.errors import PoseModelUnavailableError
from app.clips.service import AnalyzeRequest, ClipRequestError, ObservationLoader, analyze_clip
from app.metrics.catalog import build_catalog

router = APIRouter(prefix="/internal", tags=["internal"])


def get_observation_loader() -> ObservationLoader:
    """Dependency so tests can swap the (model- and video-bound) loader."""
    from app.clips.pose_video import load_observations

    return load_observations


@router.get("/metrics/catalog")
def metrics_catalog() -> dict:
    return build_catalog()


@router.post("/clips/analyze")
def analyze(body: AnalyzeRequest, loader: ObservationLoader = Depends(get_observation_loader)) -> dict:
    """Every requested metricKey yields exactly one MetricResult per side
    (estimate or unsupported). Bad video content never raises: it comes back as
    unsupported results."""
    try:
        return analyze_clip(body, loader)
    except ClipRequestError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except PoseModelUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
