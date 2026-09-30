"""Joint-angle computation per TRD 2.1:

    theta = acos( ((a - b) . (c - b)) / (||a - b|| * ||c - b||) )

with the vertex at `b`. Angles are computed in the body-centered (B) frame on
normalized landmark positions - see docs/coordinate-frames.md on why these are
NOT metric/calibrated distances.
"""
from __future__ import annotations

import math

Vec3 = tuple[float, float, float]

# (angleName, a, b, c) - vertex at b, all names are canonical joint names from
# app/pose/landmark_mapper.py. A deliberately small starting set matching the
# draft protocols in protocols/*.json (sit-to-stand, shoulder flexion/
# abduction, bodyweight squat) - extend as new exercises are added.
JOINT_ANGLE_DEFS: list[tuple[str, str, str, str]] = [
    ("leftKnee", "leftHip", "leftKnee", "leftAnkle"),
    ("rightKnee", "rightHip", "rightKnee", "rightAnkle"),
    ("leftHip", "leftShoulder", "leftHip", "leftKnee"),
    ("rightHip", "rightShoulder", "rightHip", "rightKnee"),
    ("leftElbow", "leftShoulder", "leftElbow", "leftWrist"),
    ("rightElbow", "rightShoulder", "rightElbow", "rightWrist"),
    ("leftShoulder", "leftElbow", "leftShoulder", "leftHip"),
    ("rightShoulder", "rightElbow", "rightShoulder", "rightHip"),
]


class DegenerateSegmentError(ValueError):
    """Raised when two landmarks coincide, making the angle undefined."""


def angle_theta(a: Vec3, b: Vec3, c: Vec3) -> float:
    ab = tuple(a[i] - b[i] for i in range(3))
    cb = tuple(c[i] - b[i] for i in range(3))
    norm_ab = math.sqrt(sum(v * v for v in ab))
    norm_cb = math.sqrt(sum(v * v for v in cb))
    if norm_ab == 0.0 or norm_cb == 0.0:
        raise DegenerateSegmentError("Zero-length segment between landmarks - cannot compute an angle.")
    dot = sum(ab[i] * cb[i] for i in range(3))
    cos_theta = max(-1.0, min(1.0, dot / (norm_ab * norm_cb)))
    return math.acos(cos_theta)


def compute_joint_angles(landmarks_by_name: dict[str, dict]) -> list[dict]:
    """landmarks_by_name: jointName -> the landmark dict from landmark_mapper
    (must have "position" and "observationState"). Skips (does not fabricate) an
    angle whose source landmarks are not all "observed" - partial/occluded data
    never produces a number.
    """
    from app.geometry.covariance import propagate_uncertainty

    angles: list[dict] = []
    for angle_name, a_name, b_name, c_name in JOINT_ANGLE_DEFS:
        a = landmarks_by_name.get(a_name)
        b = landmarks_by_name.get(b_name)
        c = landmarks_by_name.get(c_name)
        if not (a and b and c):
            continue
        if not all(lm["observationState"] == "observed" for lm in (a, b, c)):
            continue

        try:
            theta = angle_theta(tuple(a["position"]), tuple(b["position"]), tuple(c["position"]))
        except DegenerateSegmentError:
            continue

        angles.append(
            {
                "jointName": angle_name,
                "thetaRadians": theta,
                "uncertaintyRadians": propagate_uncertainty([a["confidence"], b["confidence"], c["confidence"]]),
                "sourceLandmarks": [a_name, b_name, c_name],
            }
        )
    return angles
