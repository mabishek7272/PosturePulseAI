"""Uncertainty propagation for joint angles.

MediaPipe exposes only a scalar visibility/presence per landmark, not a full
covariance matrix, so this is a documented APPROXIMATION (uncertainty grows as
the weakest contributing landmark's confidence drops) rather than a rigorous
error-propagation calculation through the acos() Jacobian. Revisit once a
calibrated depth/stereo pipeline provides real per-landmark covariance
(docs/coordinate-frames.md, TRD 2.1 - Phase 2+).
"""
from __future__ import annotations

# ~2.9 degrees at full confidence - placeholder, not empirically derived.
BASE_UNCERTAINTY_RADIANS = 0.05


def propagate_uncertainty(confidences: list[float]) -> float:
    if not confidences:
        return float("inf")
    weakest = max(min(confidences), 1e-3)
    return BASE_UNCERTAINTY_RADIANS / weakest
