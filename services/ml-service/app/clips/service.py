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
import numpy as np
from beaive_schemas import ClipCapture, MetricResult
from pydantic import BaseModel, Field

from app.clips.analysis import (
    MetricOutcome,
    UnknownMetricError,
    analyze_observations,
    unsupported_outcome,
    validate_metric_keys,
)
from app.clips.depth_track import (
    DepthTrackError,
    depth_health,
    info_from_sidecar,
    read_depth_track,
)
from app.clips.depth_observation import build_torso_frames
from app.clips.errors import ClipDecodeError
from app.clips.face_video import load_face_frames
from app.clips.landmark_store import store_landmark_series
from app.clips.observation import FrameObservation
from app.clips.face_video import MIN_FACE_FRAMES
from app.clips.observation import LEFT_HIP, RIGHT_HIP
from app.geometry.head_pose import head_pose_from_landmarks
from app.metrics.depth_metrics import (
    DEPTH_CALIBRATION_VERSION,
    DEPTH_MEASUREMENT_METHOD,
    DEPTH_METRIC_KEYS,
    DEPTH_METRICS_VERSION,
    compute_depth_metrics,
    unsupported as depth_unsupported,
)
from app.config import get_clip_dir
from app.geometry import intrinsics as intrinsics_module
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
    # The clip's LiDAR depth track on the shared volume (ADR-020), or None when
    # the device captured none. Optional with a None default so every existing
    # caller - and every clip recorded before the depth writer shipped - keeps
    # working byte-identically.
    depthPath: str | None = None
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


def resolve_depth_path(depth_path: str, clip_dir: Path) -> Path:
    """Same containment rule as the clip: the depth file must live in the shared
    clip directory. A path escaping it is a request bug, not a depth problem, so
    it is refused loudly rather than degraded into "no depth"."""
    root = clip_dir.resolve()
    candidate = Path(depth_path)
    resolved = (candidate if candidate.is_absolute() else root / candidate).resolve()
    if root != resolved and root not in resolved.parents:
        raise ClipRequestError(400, "depthPath must be inside the clip directory")
    return resolved


def _mid_hip_pixels(observations: list[FrameObservation]) -> tuple[float, float] | None:
    """Median mid-hip pixel over the frames that actually have a pose.

    The median, not the mean, so one badly-placed frame cannot drag the sample
    patch off the body. None when no frame had a pose - there is then no landmark
    to sample at, and no depth health block is produced rather than one taken at a
    guessed location.
    """
    points = [o.points for o in observations if o.points is not None]
    if not points:
        return None
    mid = np.array([(p[LEFT_HIP] + p[RIGHT_HIP]) / 2.0 for p in points])
    return float(np.median(mid[:, 0])), float(np.median(mid[:, 1]))


def _depth_block(
    req: AnalyzeRequest, clip_dir: Path, observations: list[FrameObservation]
) -> tuple[dict | None, list | None]:
    """The clip's depth track: `(transport-health block, decoded frames)`.

    The block is None when the clip has no depth. The frames are None unless the
    track decoded - a track in any other state (missing, undeclared, unreadable)
    yields a block describing the state and NO frames, which is what makes the
    `static3d.*` metrics come out `depth_unavailable` rather than being computed
    from whatever could be salvaged.

    Decoded ONCE here and shared: the same frames feed the health block and, when
    a `static3d.*` key was requested, the metrics. Decoding twice would risk the
    two disagreeing about what the track contained.

    Every depth failure is reported inside the block and never raised: a clip
    whose video analysed perfectly must not be failed because its depth track was
    unreadable. The health block is transport information, not a measurement; the
    `static3d.*` metrics are computed only if the battery requests them, and the
    battery is the single switch (ADR-020 is `Proposed`).
    """
    side = req.sidecar
    try:
        info = info_from_sidecar(side)
    except DepthTrackError as exc:
        return {"state": "unreadable", "error": str(exc)}, None

    if info is None and req.depthPath is None:
        return None, None
    if info is None:
        # The caller passed a file the sidecar does not describe: there is no
        # encoding, scale or timing to read it by, so it stays unread.
        return {"state": "undeclared", "error": "a depth file was supplied but the sidecar has no depth block"}, None
    if req.depthPath is None:
        return {"state": "missing", "error": "the sidecar declares a depth track but no depthPath was supplied"}, None

    path = resolve_depth_path(req.depthPath, clip_dir)
    try:
        frames = read_depth_track(path, info)
    except DepthTrackError as exc:
        return {"state": "unreadable", "error": str(exc)}, None

    block = {
        "state": "decoded",
        "width": info.width,
        "height": info.height,
        "declaredFrameCount": info.frame_count,
    }
    block.update(
        depth_health(
            frames,
            intrinsics=intrinsics_module.from_sidecar(side),
            hip_pixels=_mid_hip_pixels(observations),
            video_size=(side.width, side.height),
        )
    )
    return block, frames


def _static3d_outcomes(
    depth_keys: list[str],
    *,
    view: str,
    observations: list[FrameObservation],
    quality,
    depth_frames,
    intrinsics,
):
    """`static3d.*` outcomes for one clip, plus the join statistics.

    EVERY requested key gets exactly one outcome, an estimate or an unsupported
    with reasons - `analysis-job-runner.checkResults` rejects a missing result, and
    a key that silently vanished would be indistinguishable from one never asked
    for (CLAUDE.md rule 3).

    Ordered from "the capability was absent" to "it was there and failed", so the
    reason a clinician reads is the earliest true one:

    1. no usable depth track or no intrinsics -> `depth_unavailable`
    2. the clip failed 2D quality -> those SAME reasons (a depth value from a
       moving subject, or the wrong view, is as compromised as the 2D one; the
       only reason 3D could survive is `camera_not_level`, which is a documented
       future relaxation and not built)
    3. otherwise compute, and let `compute_depth_metrics` name what failed

    A depth failure suppresses `static3d.*` ONLY. This function is handed none of
    the 2D results and cannot touch them.
    """
    depth_present = bool(depth_frames) and intrinsics is not None
    if not depth_present:
        result = compute_depth_metrics(
            [], metric_keys=depth_keys, view=view, body_height_px=1.0, intrinsics=intrinsics, depth_present=False
        )
        return result.outcomes, None

    if quality is None:  # the video could not be decoded
        return [depth_unsupported(k, ["insufficient_frames"]) for k in depth_keys], None
    if quality.clip_reasons:
        return [depth_unsupported(k, list(quality.clip_reasons)) for k in depth_keys], None
    if quality.body_height is None:
        return [depth_unsupported(k, ["insufficient_depth_samples"]) for k in depth_keys], None

    frames, stats = build_torso_frames(observations, quality.usable_indices, depth_frames, intrinsics)
    result = compute_depth_metrics(
        frames,
        metric_keys=depth_keys,
        view=view,
        body_height_px=quality.body_height,
        intrinsics=intrinsics,
        depth_present=True,
    )
    return result.outcomes, stats


def _head_pose_block(req: AnalyzeRequest, clip_path: Path, view: str, intrinsics) -> dict | None:
    """Rigid cranio-orbital head pose, as INFORMATION only. Not a metric.

    PHASE 4 BOUNDARY, and the reason is governance rather than readiness. The
    obvious home for this is `static.head_lateral_tilt`, whose anterior value
    the rigid fit would improve roughly tenfold - 1.55 degrees against the ear
    line's 20.7. It cannot go there yet, for two reasons that both need a
    clinician:

    1. **That metric's reference entry is written for the ear line.** Its
       citation in `references/posture-reference.v0-draft.json` reads "the line
       through both ear landmarks is level with true horizontal (Kendall et
       al.)". A cranio-orbital fit does not measure that line, so the reference
       would no longer describe the quantity - it would be stale rather than
       merely conservative, and ADR-015 allows a proxy only a geometric
       reference authored for it.
    2. **`report-builder.ts` forces `position: "no_reference"`** for any
       non-default `measurementMethod`, which is the correct control. So
       switching the method would silently strip the reference band from a row
       that has one today - a visible regression in the report, arrived at by
       improving the measurement.

    Emitting it under a new key instead needs that key in the battery, which is
    the same clinician-scoped boundary as the `static3d.*` keys.

    So the pose is computed, gated and reported here, where it can be checked
    against real captures without changing a single reported number. The index
    mapping it depends on is unverified in this repository (see
    `app/clips/face_video.py`), which is another reason to look at it on real
    clips before it carries a metric.
    """
    if intrinsics is None:
        # No camera, no pose. A guessed fx would scale the whole solve.
        return None

    frames = load_face_frames(clip_path, req.sidecar, view=view)
    if len(frames) < MIN_FACE_FRAMES:
        return {"state": "unavailable", "framesWithFace": len(frames)}

    gravity = _median_gravity(req.sidecar)
    if gravity is None:
        return {"state": "unavailable", "reason": "no usable gravity reading"}

    poses = [
        head_pose_from_landmarks(frame.landmarks_px, gravity, intrinsics, view=view)
        for frame in frames
    ]
    usable = [p for p in poses if p is not None]
    if len(usable) < MIN_FACE_FRAMES:
        # Most frames failed the reprojection gate, which is what a wrong
        # landmark correspondence looks like. Reported, not silently dropped.
        return {
            "state": "rejected",
            "framesWithFace": len(frames),
            "framesPassingFit": len(usable),
        }

    rolls = np.array([p.roll_degrees for p in usable])
    return {
        "state": "computed",
        "framesWithFace": len(frames),
        "framesPassingFit": len(usable),
        "rollDegreesMedian": round(float(np.median(rolls)), 3),
        "rollDegreesMad": round(float(np.median(np.abs(rolls - np.median(rolls)))), 3),
        "rmsReprojectionPxMedian": round(float(np.median([p.rms_reprojection_px for p in usable])), 3),
        # Named so nobody reads this block as a measurement: the template is
        # generic, so a static per-person morphology offset survives every frame.
        "measures": "repeatability_not_absolute_orientation",
    }


def _median_gravity(sidecar) -> tuple[float, float, float] | None:
    """Median gravity over the clip. Adequate because a hold is static, and
    `clip_quality` already rejects a clip whose pitch moved beyond tolerance."""
    vectors = [f.gravity for f in sidecar.frames if f.gravity is not None]
    if not vectors:
        return None
    arr = np.asarray(vectors, dtype=float)
    if arr.ndim != 2 or arr.shape[1] != 3:
        return None
    median = np.median(arr, axis=0)
    return (float(median[0]), float(median[1]), float(median[2]))


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _record(req: AnalyzeRequest, m: MetricOutcome, *, clip_sha: str, series_sha: str, now: str) -> dict:
    # Depth-derived results carry their OWN versions, and a real calibration: they
    # are computed from true ARKit intrinsics, so "none/v0" would understate what
    # produced them. 2D records are untouched, byte for byte.
    depth = m.metric_key in DEPTH_METRIC_KEYS
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
            "modelVersion": f"{CLIP_MODEL_VERSION}+arkit-depth" if depth else CLIP_MODEL_VERSION,
            "adapterVersion": f"pyav/{av.__version__}",
            "calibrationVersion": DEPTH_CALIBRATION_VERSION if depth else CALIBRATION_VERSION,
            "producedAt": now,
            "metricsVersion": DEPTH_METRICS_VERSION if depth else METRICS_VERSION,
            "clipSha256": clip_sha,
            "measurementMethod": DEPTH_MEASUREMENT_METHOD if depth else "mediapipe_2d_image_plane",
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

    # Split BEFORE validating: the 2D registry rejects any key it does not know,
    # so a `static3d.*` key must never reach it. Depth keys are answered by the
    # depth path or not at all - and they only arrive if the battery lists them.
    depth_keys = [k for k in dict.fromkeys(req.metricKeys) if k in DEPTH_METRIC_KEYS]
    keys_2d = [k for k in req.metricKeys if k not in DEPTH_METRIC_KEYS]
    try:
        validate_metric_keys(keys_2d)
    except UnknownMetricError as exc:
        raise ClipRequestError(422, str(exc)) from exc

    quality = None
    try:
        observations = loader(clip_path, side)
        outcome = analyze_observations(
            observations,
            view=view,
            width=side.width,
            height=side.height,
            metric_keys=keys_2d,
            min_fps=req.minFps,
            level_tolerance_degrees=req.levelToleranceDegrees,
        )
        metrics = outcome.metrics
        frame_quality = outcome.frame_quality
        quality = outcome.quality
    except ClipDecodeError:
        observations = []
        metrics = unsupported_outcome(keys_2d, view, ["insufficient_frames"])
        frame_quality = {"usable": 0, "total": 0, "reasons": ["insufficient_frames"]}

    # Decoded once; shared by the health block and the metrics below.
    depth, depth_frames = _depth_block(req, clip_dir, observations)
    intrinsics = intrinsics_module.from_sidecar(side)
    join_stats = None
    if depth_keys:
        depth_outcomes, join_stats = _static3d_outcomes(
            depth_keys, view=view, observations=observations, quality=quality,
            depth_frames=depth_frames, intrinsics=intrinsics,
        )
        metrics = [*metrics, *depth_outcomes]

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
    response = {"results": results, "landmarkSeries": series, "frameQuality": frame_quality}
    # Added last and only when there is something to say, so a clip with no
    # depth track produces a response byte-identical to the one it produced
    # before ADR-020.
    if depth is not None:
        if join_stats is not None:
            # Why frames were dropped, by reason: "why is there no depth metric"
            # deserves an answer other than a bare unsupported flag.
            depth = {
                **depth,
                "torsoFrames": {
                    "considered": join_stats.frames_considered,
                    "kept": join_stats.frames_kept,
                    "dropped": dict(join_stats.dropped),
                    "landmarkRejections": dict(join_stats.landmark_rejections),
                },
            }
        response["depth"] = depth
    # Same shape of addition as `depth`, and for the same reason: present only
    # when there is something to say, so a clip without a face produces the
    # response it produced before this existed.
    head_pose = _head_pose_block(req, clip_path, view, intrinsics)
    if head_pose is not None:
        response["headPose"] = head_pose
    return response
