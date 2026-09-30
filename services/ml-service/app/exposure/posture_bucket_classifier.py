"""Deterministic trunk-angle threshold classifier - a v0 heuristic, NOT a
validated ergonomic exposure model (docs/claims-and-scope.md). Classifies
"valid time spent in a defined posture bucket" (TRD 2.1) from the existing
leftHip/rightHip joint angles (shoulder-hip-knee, i.e. trunk-to-thigh angle -
smaller angle means more forward flexion, ~180 degrees means upright).

Only forward-flexion buckets and 'neutral' are actually classified from this
joint set - lateral_lean and extension are NOT detected in this phase (no
lateral bending or hyperextension signal is derivable from the current
JOINT_ANGLE_DEFS) and are never fabricated; 'unclassified' covers both "no hip
angle observed this frame" and any case this v0 classifier can't place.
"""
from __future__ import annotations

# Placeholder thresholds - not clinically or ergonomically validated.
NEUTRAL_MIN_DEGREES = 160.0
MILD_FLEXION_MIN_DEGREES = 140.0
MODERATE_FLEXION_MIN_DEGREES = 110.0


def classify_posture_bucket(angles: list[dict]) -> str:
    hip_angles_degrees = [
        (a["thetaRadians"] * 180.0 / 3.141592653589793)
        for a in angles
        if a["jointName"] in ("leftHip", "rightHip")
    ]
    if not hip_angles_degrees:
        return "unclassified"

    average_hip_degrees = sum(hip_angles_degrees) / len(hip_angles_degrees)

    if average_hip_degrees >= NEUTRAL_MIN_DEGREES:
        return "neutral"
    if average_hip_degrees >= MILD_FLEXION_MIN_DEGREES:
        return "forward_flexion_mild"
    if average_hip_degrees >= MODERATE_FLEXION_MIN_DEGREES:
        return "forward_flexion_moderate"
    return "forward_flexion_severe"
