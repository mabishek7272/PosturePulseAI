"""In-memory representation of one clip frame's pose observation.

Coordinates are pixels of the oriented image (x right, y down), i.e. MediaPipe's
normalised x, y multiplied by the frame width and height - before roll
correction. Indices follow MediaPipe's 33-point PoseLandmark enum; person-left /
person-right are MediaPipe's own labels.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

NUM_LANDMARKS = 33

NOSE = 0
LEFT_EAR = 7
RIGHT_EAR = 8
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_HIP = 23
RIGHT_HIP = 24
LEFT_KNEE = 25
RIGHT_KNEE = 26
LEFT_ANKLE = 27
RIGHT_ANKLE = 28
LEFT_HEEL = 29
RIGHT_HEEL = 30

# Per-side landmark indices, keyed by MediaPipe's person-left / person-right.
SIDE_LANDMARKS: dict[str, dict[str, int]] = {
    "left": {
        "ear": LEFT_EAR,
        "shoulder": LEFT_SHOULDER,
        "hip": LEFT_HIP,
        "knee": LEFT_KNEE,
        "ankle": LEFT_ANKLE,
        "heel": LEFT_HEEL,
    },
    "right": {
        "ear": RIGHT_EAR,
        "shoulder": RIGHT_SHOULDER,
        "hip": RIGHT_HIP,
        "knee": RIGHT_KNEE,
        "ankle": RIGHT_ANKLE,
        "heel": RIGHT_HEEL,
    },
}


@dataclass
class FrameObservation:
    """One sidecar frame. `points`/`visibility` are None when no pose was
    detected (or the frame could not be decoded) - never filled in."""

    index: int
    t: float
    gravity: tuple[float, float, float]
    points: np.ndarray | None = None  # (33, 2) pixels, before roll correction
    visibility: np.ndarray | None = None  # (33,) MediaPipe visibility, 0..1
