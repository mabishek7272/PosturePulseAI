"""Builds schema-valid PoseLandmarkFrame / QualityGateFlag / CalibratedJointFrame
records and validates them against the generated Pydantic models (beaive_schemas
- packages/schemas/generated/python, installed editable per root README) before
returning. Fails loudly (pydantic ValidationError) rather than emit a malformed
record - see docs/adr/002-schema-source-of-truth.md.
"""
from __future__ import annotations

from datetime import datetime, timezone

from beaive_schemas import (
    CalibratedJointFrame,
    MovementPhaseEvent,
    ObjectDetectionFrame,
    PoseLandmarkFrame,
    QualityGateFlag,
    ScaleCalibrationRecord,
)

from app.geometry.coordinate_frames import NO_SCALE_CALIBRATION_REF, CoordinateFrame, is_scale_validated
from app.versioning import (
    CALIBRATION_VERSION,
    MODEL_VERSION,
    SCHEMA_VERSION_CALIBRATED_JOINT_FRAME,
    SCHEMA_VERSION_OBJECT_DETECTION_FRAME,
    SCHEMA_VERSION_POSE_LANDMARK_FRAME,
    SCHEMA_VERSION_SCALE_CALIBRATION_RECORD,
)


def build_pose_landmark_frame(session_id: str, frame_id: str, person_track_id: str, landmarks: list[dict]) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    record = {
        "frameId": frame_id,
        "sessionId": session_id,
        "personTrackId": person_track_id,
        "capturedAt": now,
        "frame": CoordinateFrame.BODY.value,
        "landmarks": landmarks,
        "provenance": {
            "schemaVersion": SCHEMA_VERSION_POSE_LANDMARK_FRAME,
            "modelVersion": MODEL_VERSION,
            "calibrationVersion": CALIBRATION_VERSION,
            "producedAt": now,
        },
    }
    validated = PoseLandmarkFrame.model_validate(record)
    return validated.model_dump(mode="json", exclude_unset=True)


def build_quality_gate_flag_validated(flag: dict) -> dict:
    validated = QualityGateFlag.model_validate(flag)
    return validated.model_dump(mode="json", exclude_unset=True)


def build_calibrated_joint_frame(
    session_id: str, frame_id: str, source_frame_id: str, scale_calibration_ref: str | None, angles: list[dict]
) -> dict:
    """`scale_calibration_ref` is whatever backend-api resolved for this session
    (a real ScaleCalibrationRecord id, or None if the session was never scale-
    calibrated) - ml-service never guesses this itself (see
    geometry/coordinate_frames.py#is_scale_validated). Callers must not invoke
    this with an empty `angles` list (the schema requires minItems 1) - skip
    building a CalibratedJointFrame entirely for a frame with zero computable
    angles, same discipline as the quality gate's occlusion handling.
    """
    now = datetime.now(timezone.utc).isoformat()
    record = {
        "jointFrameId": frame_id,
        "sessionId": session_id,
        "sourceFrameId": source_frame_id,
        "capturedAt": now,
        "frame": CoordinateFrame.BODY.value,
        "scaleValidated": is_scale_validated(scale_calibration_ref),
        "calibrationRef": scale_calibration_ref or NO_SCALE_CALIBRATION_REF,
        "angles": angles,
        "provenance": {
            "schemaVersion": SCHEMA_VERSION_CALIBRATED_JOINT_FRAME,
            "modelVersion": MODEL_VERSION,
            "calibrationVersion": CALIBRATION_VERSION,
            "producedAt": now,
        },
    }
    validated = CalibratedJointFrame.model_validate(record)
    return validated.model_dump(mode="json", exclude_unset=True)


def build_scale_calibration_record_validated(record_without_provenance: dict) -> dict:
    """Adds the provenance block to a record built by
    geometry/scale_calibration.py#build_scale_calibration_record, then
    validates against the generated Pydantic model."""
    now = datetime.now(timezone.utc).isoformat()
    record = {
        **record_without_provenance,
        "provenance": {
            "schemaVersion": SCHEMA_VERSION_SCALE_CALIBRATION_RECORD,
            "modelVersion": "subject-specific-calibration/v0",
            "calibrationVersion": CALIBRATION_VERSION,
            "producedAt": now,
        },
    }
    validated = ScaleCalibrationRecord.model_validate(record)
    return validated.model_dump(mode="json", exclude_unset=True)


def build_object_detection_frame_validated(record_without_provenance: dict) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    record = {
        **record_without_provenance,
        "provenance": {
            "schemaVersion": SCHEMA_VERSION_OBJECT_DETECTION_FRAME,
            "modelVersion": "torchvision-fasterrcnn-mobilenet-v3-320/v0",
            "calibrationVersion": CALIBRATION_VERSION,
            "producedAt": now,
        },
    }
    validated = ObjectDetectionFrame.model_validate(record)
    return validated.model_dump(mode="json", exclude_unset=True)


def build_movement_phase_event_validated(record: dict) -> dict:
    """`record` must already be a complete movement-phase-event dict
    (app/movement/movement_window_service.py builds its own provenance,
    unlike the other builders here) - this only validates."""
    validated = MovementPhaseEvent.model_validate(record)
    return validated.model_dump(mode="json", exclude_unset=True)
