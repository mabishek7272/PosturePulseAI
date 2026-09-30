from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.detection.object_detection_builder import build_object_detection_frame
from app.detection.yolo_adapter import ObjectDetectionAdapter
from app.events.emitter import (
    build_calibrated_joint_frame,
    build_movement_phase_event_validated,
    build_object_detection_frame_validated,
    build_pose_landmark_frame,
    build_quality_gate_flag_validated,
    build_scale_calibration_record_validated,
)
from app.exposure.posture_bucket_classifier import classify_posture_bucket
from app.geometry.kinematics import compute_joint_angles
from app.geometry.scale_calibration import build_scale_calibration_record, compute_subject_specific_scale
from app.ingestion.rest_ingest import decode_base64_image, decode_base64_image_as_tensor
from app.movement.movement_window_service import run_movement_window
from app.pose.landmark_mapper import map_landmarks_to_frame
from app.pose.mediapipe_adapter import MediaPipePoseAdapter
from app.quality.quality_gate import evaluate_quality
from app.quality.unsupported_state import build_quality_gate_flag

router = APIRouter(prefix="/internal", tags=["internal"])

_adapter: MediaPipePoseAdapter | None = None
_detection_adapter: ObjectDetectionAdapter | None = None


def get_adapter() -> MediaPipePoseAdapter:
    """Lazily constructs the (relatively expensive) PoseLandmarker once per process."""
    global _adapter
    if _adapter is None:
        _adapter = MediaPipePoseAdapter()
    return _adapter


def get_detection_adapter() -> ObjectDetectionAdapter:
    global _detection_adapter
    if _detection_adapter is None:
        _detection_adapter = ObjectDetectionAdapter()
    return _detection_adapter


class FrameSubmission(BaseModel):
    sessionId: str
    frameId: str
    capturedAt: str
    imageBase64: str
    # Resolved by backend-api (which owns Session/ScaleCalibrationRecord data) -
    # ml-service has no database of its own and never guesses this. None means
    # "this session has not been scale-calibrated", not "unknown" - see
    # app/geometry/coordinate_frames.py#is_scale_validated.
    scaleCalibrationRef: str | None = None


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.post("/frames")
def submit_frame(body: FrameSubmission) -> dict:
    try:
        image = decode_base64_image(body.imageBase64)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    raw_landmarks = get_adapter().detect_on_image(image)
    landmarks = map_landmarks_to_frame(raw_landmarks)

    pose_frame = build_pose_landmark_frame(
        session_id=body.sessionId,
        frame_id=body.frameId,
        # Single-person tracking only in this phase (PRD P0 scope).
        person_track_id=f"{body.sessionId}:person-0",
        landmarks=landmarks,
    )

    assessment = evaluate_quality(landmarks)
    quality_flag = build_quality_gate_flag_validated(build_quality_gate_flag(body.sessionId, body.frameId, assessment))

    landmarks_by_name = {lm["jointName"]: lm for lm in landmarks}
    angles = compute_joint_angles(landmarks_by_name)
    calibrated_joint_frame = None
    if angles:
        # angles is only non-empty when at least one full (a,b,c)-observed
        # triple exists - see kinematics.compute_joint_angles. An empty result
        # means no computable angle this frame; we skip building the record
        # entirely rather than emit one with a fabricated/empty angles list.
        calibrated_joint_frame = build_calibrated_joint_frame(
            session_id=body.sessionId,
            frame_id=f"{body.frameId}:joints",
            source_frame_id=body.frameId,
            scale_calibration_ref=body.scaleCalibrationRef,
            angles=angles,
        )

    # Not a schema-validated record itself - a plain hint backend-api's
    # ExposureAggregatorService consumes to build the real, evidence-backed
    # ExposureEvent. null (not "unclassified") when there are no angles at
    # all to classify from.
    posture_bucket_hint = classify_posture_bucket(angles) if angles else None

    return {
        "poseLandmarkFrame": pose_frame,
        "qualityGateFlag": quality_flag,
        "calibratedJointFrame": calibrated_joint_frame,
        "postureBucketHint": posture_bucket_hint,
    }


class ScaleCalibrationSubmission(BaseModel):
    sessionId: str
    frameId: str
    imageBase64: str
    subjectHeightMeters: float


@router.post("/calibrate-scale")
def calibrate_scale(body: ScaleCalibrationSubmission) -> dict:
    """Subject-specific scale calibration only (docs/adr/008). Returns 422,
    not a fabricated calibration, when the ankle/nose landmarks needed for the
    calculation aren't fully observed in this frame - the caller should ask
    the user to reposition and retry, not silently accept an unvalidated scale.
    """
    try:
        image = decode_base64_image(body.imageBase64)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    raw_landmarks = get_adapter().detect_on_image(image)
    landmarks = map_landmarks_to_frame(raw_landmarks)
    landmarks_by_name = {lm["jointName"]: lm for lm in landmarks}

    computed = compute_subject_specific_scale(landmarks_by_name, body.subjectHeightMeters)
    if computed is None:
        raise HTTPException(
            status_code=422,
            detail="Could not compute a scale calibration - ankle and/or nose landmarks were not fully observed in this frame.",
        )

    record = build_scale_calibration_record(body.sessionId, body.frameId, computed)
    return build_scale_calibration_record_validated(record)


class DetectObjectsSubmission(BaseModel):
    sessionId: str
    frameId: str
    imageBase64: str


@router.post("/detect-objects")
def detect_objects(body: DetectObjectsSubmission) -> dict:
    """Separate, low-cadence endpoint (TRD 2.2) - object detection is sampled
    far less often than pose, so it is never folded into /internal/frames.
    Generic COCO-class detector only - see app/detection/yolo_adapter.py.
    """
    try:
        image_tensor = decode_base64_image_as_tensor(body.imageBase64)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    raw_detections = get_detection_adapter().detect(image_tensor)
    frame = build_object_detection_frame(body.sessionId, body.frameId, raw_detections)
    return build_object_detection_frame_validated(frame)


class MovementWindowSubmission(BaseModel):
    sessionId: str
    exerciseId: str
    windowStartAt: str
    windowEndAt: str
    jointAngleSequence: list[list[dict]]
    sourceFrameIds: list[str]
    modelArchitecture: str = "tcn"


@router.post("/movement-window")
def movement_window(body: MovementWindowSubmission) -> dict:
    """ST-GCN/TCN descriptive output only (TRD 2.2) - see
    app/movement/movement_window_service.py. `validated` is always False;
    this never drives a safety decision (docs/adr/005).
    """
    try:
        record = run_movement_window(
            session_id=body.sessionId,
            exercise_id=body.exerciseId,
            window_start_at=body.windowStartAt,
            window_end_at=body.windowEndAt,
            joint_angle_sequence=body.jointAngleSequence,
            source_frame_ids=body.sourceFrameIds,
            model_architecture=body.modelArchitecture,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return build_movement_phase_event_validated(record)
