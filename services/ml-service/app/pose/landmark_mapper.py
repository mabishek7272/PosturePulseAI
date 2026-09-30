"""Maps MediaPipe's 33 PoseLandmark indices onto beAIve's canonical joint names,
and onto the PoseLandmarkFrame.landmarks shape (packages/schemas/src/pose-landmark-frame.schema.json).

Every canonical joint always appears in the output, even when raw_landmarks is
empty (no person detected) or shorter than expected - missing joints are marked
occluded/null rather than silently absent. This is the enforcement point for
"never impute an occluded joint as observed": a landmark below the visibility
threshold is discarded and reported as occluded/null even though MediaPipe may
have returned a low-confidence coordinate for it.
"""
from __future__ import annotations

from typing import Sequence

from mediapipe.tasks.python.vision import PoseLandmark

from app.config import LANDMARK_VISIBILITY_THRESHOLD
from app.pose.mediapipe_adapter import RawLandmark


def _to_camel_case(enum_name: str) -> str:
    parts = enum_name.split("_")
    return parts[0].lower() + "".join(part.capitalize() for part in parts[1:])


CANONICAL_JOINT_NAMES: list[str] = [_to_camel_case(lm.name) for lm in PoseLandmark]


def map_landmarks_to_frame(raw_landmarks: Sequence[RawLandmark]) -> list[dict]:
    result: list[dict] = []
    for index, joint_name in enumerate(CANONICAL_JOINT_NAMES):
        landmark = raw_landmarks[index] if index < len(raw_landmarks) else None
        visibility = min(landmark.visibility, landmark.presence) if landmark else 0.0

        if landmark is not None and visibility >= LANDMARK_VISIBILITY_THRESHOLD:
            result.append(
                {
                    "jointName": joint_name,
                    "position": [landmark.x, landmark.y, landmark.z],
                    "confidence": visibility,
                    "covariance": None,
                    "observationState": "observed",
                }
            )
        else:
            result.append(
                {
                    "jointName": joint_name,
                    "position": None,
                    "confidence": visibility,
                    "covariance": None,
                    "observationState": "occluded",
                }
            )
    return result
