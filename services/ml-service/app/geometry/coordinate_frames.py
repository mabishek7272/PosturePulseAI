"""TRD 2.1 coordinate frames - see docs/coordinate-frames.md for the full
reference. This module exists so code has a single named place to reference
the frame convention and the scale-validation gap, rather than each caller
re-deciding it.
"""
from __future__ import annotations

from enum import Enum


class CoordinateFrame(str, Enum):
    IMAGE = "I"
    CAMERA = "C"
    WORLD = "W"
    BODY = "B"
    OBJECT = "O"


# Sentinel calibrationRef used when no scale-calibration-record exists for the
# session. calibrated-joint-frame.calibrationRef is a required string field,
# so this stands in for "no calibration" rather than leaving it empty.
NO_SCALE_CALIBRATION_REF = "none/v0"


def is_scale_validated(scale_calibration_ref: str | None) -> bool:
    """True only when backend-api has resolved and passed a real
    ScaleCalibrationRecord id for this session (see geometry/scale_calibration.py
    - only the subject_specific method is implemented this phase, docs/adr/008).
    ml-service has no database of its own; it never guesses this - the caller
    (backend-api, via the FrameSubmission payload) is the one source of truth
    for whether a session has been scale-calibrated. Passing None here must
    always yield False - do not flip this without a real calibration record.
    """
    return scale_calibration_ref is not None
