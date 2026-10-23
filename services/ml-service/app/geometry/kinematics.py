"""Joint-angle computation per TRD 2.1:

    theta = acos( ((a - b) . (c - b)) / (||a - b|| * ||c - b||) )

with the vertex at `b`. Angles are measured in the 2D image plane, in pixels:
MediaPipe normalizes x by image width and y by image height, so on a
non-square frame those axes have different scales and must be rescaled before
any angle is taken. Image z (a relative, unscaled depth) is deliberately not
used. These are image-plane estimates, not metric or calibrated distances -
see docs/coordinate-frames.md.
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


def to_image_plane(position: list[float], image_size: tuple[int, int]) -> Vec3:
    """Normalized [x, y, z] -> pixel (x, y, 0) for image_size = (width, height)."""
    width, height = image_size
    return (position[0] * width, position[1] * height, 0.0)


def compute_joint_angles(landmarks_by_name: dict[str, dict], *, image_size: tuple[int, int]) -> list[dict]:
    """landmarks_by_name: jointName -> the landmark dict from landmark_mapper
    (must have "position" and "observationState"); image_size: (width, height)
    of the frame the landmarks came from. Skips (does not fabricate) an angle
    whose source landmarks are not all "observed" - partial/occluded data never
    produces a number.
    """
    from app.geometry.covariance import propagate_uncertainty

    if image_size[0] <= 0 or image_size[1] <= 0:
        raise ValueError(f"image_size must be positive, got {image_size}")

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
            theta = angle_theta(*(to_image_plane(lm["position"], image_size) for lm in (a, b, c)))
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
