"""Records the model/adapter/calibration version that goes into every emitted
record's `provenance` block (TRD traceability requirement) - see
docs/traceability-matrix.md."""
from __future__ import annotations

import mediapipe

MODEL_VERSION = f"mediapipe-pose-landmarker-lite/{mediapipe.__version__}"

# No scale/reprojection check (depth, known-size reference, stereo, subject
# calibration) is implemented in this phase - this is the honest, hard-coded
# value until one exists. See docs/coordinate-frames.md and
# docs/traceability-matrix.md "Known gap in this phase".
CALIBRATION_VERSION = "none/v0"

SCHEMA_VERSION_POSE_LANDMARK_FRAME = "pose-landmark-frame/v0"
SCHEMA_VERSION_QUALITY_GATE_FLAG = "quality-gate-flag/v0"
SCHEMA_VERSION_CALIBRATED_JOINT_FRAME = "calibrated-joint-frame/v0"
SCHEMA_VERSION_SCALE_CALIBRATION_RECORD = "scale-calibration-record/v0"
SCHEMA_VERSION_OBJECT_DETECTION_FRAME = "object-detection-frame/v0"
SCHEMA_VERSION_MOVEMENT_PHASE_EVENT = "movement-phase-event/v0"
