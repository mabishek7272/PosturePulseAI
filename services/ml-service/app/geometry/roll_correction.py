"""Per-frame camera roll correction and pitch from the clip sidecar's gravity.

The sidecar (packages/schemas/src/clip-capture.schema.json) gives the unit
gravity direction in the oriented image's camera frame: x = image right,
y = image down, z = optical axis. A level phone filming upright reports about
[0, 1, 0].

Roll (rotation about the optical axis) can be undone in 2D: rotate the landmark
points so gravity's image-plane component points straight down (+y). Pitch
(tilt toward/away from the subject) cannot be undone from a single 2D image, so
it is only measured and used to reject the clip (`camera_not_level`).
"""
from __future__ import annotations

import math
from typing import Sequence

import numpy as np

# Below this image-plane magnitude the gravity vector is (nearly) along the
# optical axis - the phone is flat - and has no meaningful roll direction.
_MIN_IN_PLANE = 1e-6


def roll_angle_radians(gravity: Sequence[float]) -> float:
    """Angle by which image points are rotated (x right, y down; positive
    turns +x toward +y) so that gravity's in-plane component maps to +y.

    gravity_in_plane = (sin phi, cos phi) -> rotating by phi gives (0, 1).
    Returns 0.0 for a degenerate (flat-phone) gravity vector.
    """
    gx, gy = float(gravity[0]), float(gravity[1])
    if math.hypot(gx, gy) < _MIN_IN_PLANE:
        return 0.0
    return math.atan2(gx, gy)


def pitch_degrees(gravity: Sequence[float]) -> float:
    """asin(|g_z|) of the unit-normalised gravity vector, in degrees. A zero
    vector is reported as 90 so it can never pass a level check."""
    g = np.asarray(gravity, dtype=float)
    norm = float(np.linalg.norm(g))
    if norm < _MIN_IN_PLANE:
        return 90.0
    return math.degrees(math.asin(min(1.0, abs(g[2]) / norm)))


def correct_roll(points: np.ndarray, gravity: Sequence[float], center: tuple[float, float]) -> np.ndarray:
    """Rotates (N, 2) pixel points about `center` so gravity points to +y."""
    angle = roll_angle_radians(gravity)
    c, s = math.cos(angle), math.sin(angle)
    rot = np.array([[c, -s], [s, c]])
    origin = np.asarray(center, dtype=float)
    return (np.asarray(points, dtype=float) - origin) @ rot.T + origin
