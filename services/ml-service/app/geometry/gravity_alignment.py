"""Rotation that takes the camera frame into a gravity-aligned frame (ADR-020).

`R_g` removes camera roll **and** pitch at once - strictly more than the 2D
path's `correct_roll` can, which is why `roll_correction.py` says pitch "cannot
be undone from a single 2D image, so it is only measured and used to reject the
clip". It does **not** remove the free yaw about gravity, translation, metric
scale error, lens distortion or depth bias. Nothing here recovers those.

Frame and target
----------------
The sidecar's camera frame C is: x = image right, **y = image down**, z = optical
axis away from the camera. A level camera filming upright therefore reports
gravity as approximately `[0, +1, 0]`, and that is the target this module
rotates onto.

The target is **`[0, +1, 0]`, not `[0, -1, 0]`.** With `[0, -1, 0]` the subject
comes out upside down and every coronal and sagittal sign flips - and because a
rotation preserves vector magnitudes, nothing about the output looks wrong. Every
angle still has a plausible value; only its sign is inverted. Keeping y = down
also means every sign convention already declared in
`app/metrics/static_metrics.py` carries over unchanged, so the 3D and 2D rows for
one body cannot disagree about which shoulder is high.

Axis direction
--------------
To rotate `a` onto `b` the Rodrigues axis is `v = a x b`, i.e.
`v = g x target`. For `target = [0, 1, 0]` that is

    v = g x [0,1,0] = [-g_z, 0, g_x]

and **not** `[g_z, 0, -g_x]`, which is its negative. The negated axis produces
the transpose of the intended rotation, which does not undo the tilt - it
*doubles* it: a 10-degree pitch comes out as 20, a 20 as 40. Like the target-sign
error it is invisible in any magnitude, which is why
`test_gravity_alignment.py` asserts `R @ g == [0, 1, 0]` to 1e-12 rather than
checking that some angle looks reasonable.

Which Rodrigues form, and why not the compact one
-------------------------------------------------
The compact form `R = I + [v]_x + [v]_x^2 / (1 + c)`, with `v = g x target`
un-normalised, is algebraically correct but numerically poor near antiparallel,
and measurably so well before it: at 1e-6 rad from upside down it returns a
rotation that misses the target by 1.8e-4, at 1e-7 by **4.7e-2**, and below
about 1e-8 `1 + c` underflows to exactly zero and the result is `nan`. The
failure is in the arithmetic, not the algebra, so no amount of care with signs
avoids it.

This module uses the explicit angle form instead,

    R = I + sin(t) [k]_x + (1 - cos(t)) [k]_x^2,
    k = v / |v|,   t = atan2(|v|, c)

which has no such division and is accurate to machine precision across the
entire range - measured worst case `|R g - target|` of 1.0e-15 over pitches 0 to
180 degrees at three rolls, and 2e-16 even 1e-16 away from antiparallel. The
only genuinely degenerate input is `|v| == 0` exactly, which is either already
aligned (return the identity) or exactly inverted (any perpendicular axis gives
a valid 180-degree rotation).
"""
from __future__ import annotations

import numpy as np

TARGET = np.array([0.0, 1.0, 0.0])

# The ONLY degenerate case for the explicit-angle form: gravity exactly parallel
# or exactly antiparallel to the target, where the axis is undetermined because
# the cross product vanishes. Everything else, down to 1e-16 rad from inverted,
# goes through the general branch at machine precision - so this is a test for
# an exactly-zero axis, not a tolerance band that trades away accuracy.
_DEGENERATE_AXIS = 1e-300


def skew(v: np.ndarray) -> np.ndarray:
    """The cross-product matrix `[v]_x`, so that `[v]_x @ u == cross(v, u)`."""
    return np.array(
        [
            [0.0, -v[2], v[1]],
            [v[2], 0.0, -v[0]],
            [-v[1], v[0], 0.0],
        ]
    )


def rotation_to_gravity_frame(gravity: np.ndarray | tuple[float, float, float]) -> np.ndarray | None:
    """`R_g` such that `R_g @ gravity` is `[0, 1, 0]`.

    Returns `None` - never an approximate rotation - when the gravity reading is
    not a usable direction (non-finite, or too short to normalise). A clip whose
    gravity cannot be trusted must produce no depth-derived value at all; a
    substituted identity would silently report an un-levelled measurement as a
    levelled one (CLAUDE.md rule 3).
    """
    g = np.asarray(gravity, dtype=float).reshape(-1)
    if g.shape != (3,) or not np.all(np.isfinite(g)):
        return None
    norm = float(np.linalg.norm(g))
    if norm < 1e-9:
        return None
    g = g / norm

    c = float(g @ TARGET)
    v = np.cross(g, TARGET)
    sin_t = float(np.linalg.norm(v))

    if sin_t <= _DEGENERATE_AXIS:
        if c > 0.0:
            return np.eye(3)
        # Exactly upside down: the axis is undetermined, so any axis
        # perpendicular to gravity gives a valid 180-degree rotation.
        # `2 n n^T - I` has eigenvalues (+1, -1, -1) and determinant +1, so it
        # is a proper rotation, not a reflection.
        #
        # A real case, not a theoretical one: an iPad handed over or set
        # face-down reads gravity antiparallel for a frame or two.
        n = _unit_perpendicular(g)
        return 2.0 * np.outer(n, n) - np.eye(3)

    k = skew(v / sin_t)
    theta = float(np.arctan2(sin_t, c))
    return np.eye(3) + np.sin(theta) * k + (1.0 - np.cos(theta)) * (k @ k)


def _unit_perpendicular(g: np.ndarray) -> np.ndarray:
    """Some unit vector perpendicular to `g`.

    Crossing with the axis `g` leans on least keeps the result well away from
    zero length, so the normalisation is numerically safe for any input.
    """
    helper = np.zeros(3)
    helper[int(np.argmin(np.abs(g)))] = 1.0
    n = np.cross(g, helper)
    return n / float(np.linalg.norm(n))


def to_gravity_frame(
    points_cam: np.ndarray, gravity: np.ndarray | tuple[float, float, float]
) -> np.ndarray | None:
    """`(N, 3)` camera-frame points expressed in the gravity-aligned frame.

    `None` when the gravity reading is unusable, propagating the refusal rather
    than returning un-levelled points that look levelled.
    """
    r = rotation_to_gravity_frame(gravity)
    if r is None:
        return None
    p = np.asarray(points_cam, dtype=float)
    if p.ndim != 2 or p.shape[1] != 3:
        raise ValueError("points_cam must have shape (N, 3)")
    return p @ r.T


def residual_pitch_degrees(r: np.ndarray, gravity: np.ndarray | tuple[float, float, float]) -> float:
    """How far `r @ gravity` still is from vertical, in degrees.

    Zero for a correct `R_g`. Exists so a test can state the failure in the
    units the bug appears in: the negated-axis error reports twice the input
    pitch here, and the flipped-target error reports 180 minus it.
    """
    g = np.asarray(gravity, dtype=float).reshape(3)
    g = g / float(np.linalg.norm(g))
    aligned = np.asarray(r, dtype=float) @ g
    cos = float(np.clip(aligned @ TARGET, -1.0, 1.0))
    return float(np.degrees(np.arccos(cos)))
