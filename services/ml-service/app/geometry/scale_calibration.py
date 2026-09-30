"""Subject-specific scale calibration - the only one of the four TRD 2.1
approved scale-validation methods implemented this phase (docs/adr/008-scale-
calibration-scope.md). The other three (known_size_reference, calibrated_depth,
stereo_multiview) need real reference-object photography or ARKit depth
hardware unavailable in this sandbox.

Divides a real-world height (user-entered) by the normalized ankle-to-nose
landmark distance from a single calibration-time frame. Never fabricates a
scale factor: returns None if the required landmarks aren't fully observed.
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone

# Ratio of (ankle-to-nose landmark distance) to true standing height is not
# exactly 1.0 (the nose landmark sits below the crown of the head; the ankle
# landmark sits above the sole) - this is a v0 approximation, not an
# anthropometrically validated model. Documented placeholder, same honesty
# pattern as geometry/covariance.py's uncertainty approximation.
ANKLE_TO_NOSE_HEIGHT_FRACTION = 0.97


def compute_subject_specific_scale(landmarks_by_name: dict, subject_height_meters: float) -> dict | None:
    if subject_height_meters <= 0:
        raise ValueError("subject_height_meters must be positive")

    ankle = landmarks_by_name.get("leftAnkle") or landmarks_by_name.get("rightAnkle")
    nose = landmarks_by_name.get("nose")
    if not ankle or not nose:
        return None
    if ankle["observationState"] != "observed" or nose["observationState"] != "observed":
        return None

    ax, ay, az = ankle["position"]
    nx, ny, nz = nose["position"]
    normalized_span = math.sqrt((ax - nx) ** 2 + (ay - ny) ** 2 + (az - nz) ** 2)
    if normalized_span <= 0:
        return None

    approx_standing_height = subject_height_meters * ANKLE_TO_NOSE_HEIGHT_FRACTION
    scale_factor = approx_standing_height / normalized_span

    # Placeholder proportional uncertainty term - not a rigorous propagation of
    # landmark confidence into scale-factor uncertainty.
    weakest_confidence = min(ankle["confidence"], nose["confidence"])
    uncertainty = scale_factor * (1.0 - weakest_confidence) * 0.5

    return {
        "method": "subject_specific",
        "subjectHeightMeters": subject_height_meters,
        "scaleFactorMetersPerUnit": scale_factor,
        "uncertaintyMetersPerUnit": uncertainty,
    }


def build_scale_calibration_record(session_id: str, reference_source_frame_id: str, computed: dict) -> dict:
    """Wraps compute_subject_specific_scale's numeric output with ids/session/
    provenance - mirrors the quality_gate.py -> unsupported_state.py split.
    """
    return {
        "scaleCalibrationId": str(uuid.uuid4()),
        "sessionId": session_id,
        "method": computed["method"],
        "validatedAt": datetime.now(timezone.utc).isoformat(),
        "subjectHeightMeters": computed["subjectHeightMeters"],
        "referenceSourceFrameId": reference_source_frame_id,
        "scaleFactorMetersPerUnit": computed["scaleFactorMetersPerUnit"],
        "uncertaintyMetersPerUnit": computed["uncertaintyMetersPerUnit"],
    }
