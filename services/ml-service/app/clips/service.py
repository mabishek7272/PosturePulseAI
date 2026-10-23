"""POST /internal/clips/analyze orchestration (ADR-013): clip file + sidecar ->
pose observations -> metric outcomes -> schema-validated MetricResult records,
plus the stored landmark series.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import av
from beaive_schemas import ClipCapture, MetricResult
from pydantic import BaseModel, Field

from app.clips.analysis import (
    MetricOutcome,
    UnknownMetricError,
    analyze_observations,
    unsupported_outcome,
    validate_metric_keys,
)
from app.clips.errors import ClipDecodeError
from app.clips.landmark_store import store_landmark_series
from app.clips.observation import FrameObservation
from app.config import get_clip_dir
from app.versioning import (
    CALIBRATION_VERSION,
    CLIP_MODEL_VERSION,
    METRICS_VERSION,
    SCHEMA_VERSION_METRIC_RESULT,
)

ObservationLoader = Callable[[Path, ClipCapture], list[FrameObservation]]


class ClipRequestError(Exception):
    """The request itself is wrong (maps to an HTTP error), as opposed to bad video content."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class AnalyzeRequest(BaseModel):
    sessionId: str
    clipId: str
    stepId: str
    clipPath: str
    sidecar: ClipCapture
    metricKeys: list[str] = Field(min_length=1)
    minFps: float = Field(gt=0)
    levelToleranceDegrees: float = Field(gt=0)


def resolve_clip_path(clip_path: str, clip_dir: Path) -> Path:
    """The clip must be a file inside the shared clip directory."""
    root = clip_dir.resolve()
    candidate = Path(clip_path)
    resolved = (candidate if candidate.is_absolute() else root / candidate).resolve()
    if root != resolved and root not in resolved.parents:
        raise ClipRequestError(400, "clipPath must be inside the clip directory")
    if not resolved.is_file():
        raise ClipRequestError(404, "clip file not found")
    return resolved


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _record(req: AnalyzeRequest, m: MetricOutcome, *, clip_sha: str, series_sha: str, now: str) -> dict:
    record: dict = {
        "resultId": str(uuid.uuid4()),
        "sessionId": req.sessionId,
        "clipId": req.clipId,
        "stepId": req.stepId,
        "metricKey": m.metric_key,
        "module": m.module,
        "tier": m.tier,
        "unit": m.unit,
        "side": m.side,
        "evidence": {"landmarkSeriesSha256": series_sha},
        "provenance": {
            "schemaVersion": SCHEMA_VERSION_METRIC_RESULT,
            "modelVersion": CLIP_MODEL_VERSION,
            "adapterVersion": f"pyav/{av.__version__}",
            "calibrationVersion": CALIBRATION_VERSION,
            "producedAt": now,
            "metricsVersion": METRICS_VERSION,
            "clipSha256": clip_sha,
        },
    }
    if m.reasons is None:
        record["estimate"] = {
            "value": m.value,
            "uncertainty": m.uncertainty,
            "framesUsed": m.frames_used,
            "signConvention": m.sign_convention,
        }
        record["evidence"]["frameIndices"] = m.frame_indices
    else:
        record["unsupported"] = {"reasons": m.reasons}
    return MetricResult.model_validate(record).model_dump(mode="json", exclude_unset=True)


def analyze_clip(req: AnalyzeRequest, loader: ObservationLoader) -> dict:
    side = req.sidecar
    if side.clipId != req.clipId or side.sessionId != req.sessionId or side.stepId != req.stepId:
        raise ClipRequestError(422, "sidecar clipId/sessionId/stepId do not match the request")
    view = side.view.value
    clip_dir = get_clip_dir()
    clip_path = resolve_clip_path(req.clipPath, clip_dir)

    try:
        validate_metric_keys(req.metricKeys)
    except UnknownMetricError as exc:
        raise ClipRequestError(422, str(exc)) from exc

    try:
        observations = loader(clip_path, side)
        outcome = analyze_observations(
            observations,
            view=view,
            width=side.width,
            height=side.height,
            metric_keys=req.metricKeys,
            min_fps=req.minFps,
            level_tolerance_degrees=req.levelToleranceDegrees,
        )
        metrics = outcome.metrics
        frame_quality = outcome.frame_quality
    except ClipDecodeError:
        observations = []
        metrics = unsupported_outcome(req.metricKeys, view, ["insufficient_frames"])
        frame_quality = {"usable": 0, "total": 0, "reasons": ["insufficient_frames"]}

    try:
        series = store_landmark_series(
            clip_dir,
            clip_id=req.clipId,
            session_id=req.sessionId,
            step_id=req.stepId,
            view=view,
            width=side.width,
            height=side.height,
            model_version=CLIP_MODEL_VERSION,
            observations=observations,
        )
    except ValueError as exc:
        raise ClipRequestError(422, str(exc)) from exc

    clip_sha = _sha256_file(clip_path)
    now = datetime.now(timezone.utc).isoformat()
    results = [_record(req, m, clip_sha=clip_sha, series_sha=series["sha256"], now=now) for m in metrics]
    return {"results": results, "landmarkSeries": series, "frameQuality": frame_quality}
