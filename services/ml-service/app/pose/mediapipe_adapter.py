"""Wraps MediaPipe Tasks PoseLandmarker (TRD 2.2: MediaPipe Pose is the initial
lightweight landmark baseline candidate, not yet a validated choice - benchmarking
against alternatives on real target phones is a later-phase backlog item, PRD
4.5 item 4).

Requires a downloaded .task model bundle - see services/ml-service/README.md for
the fetch command. Not committed to the repo (it's a multi-MB binary asset with
its own license, not source code).
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import PoseLandmarker, PoseLandmarkerOptions, RunningMode

from app.config import POSE_LANDMARKER_MODEL_PATH


@dataclass(frozen=True)
class RawLandmark:
    x: float
    y: float
    z: float
    visibility: float
    presence: float


class MediaPipePoseAdapter:
    """Loads a PoseLandmarker once per process and exposes detect_on_image()."""

    def __init__(self, model_path: Path | None = None) -> None:
        path = model_path or POSE_LANDMARKER_MODEL_PATH
        if not path.exists():
            raise FileNotFoundError(
                f"Pose landmarker model not found at {path}. "
                "Run `services/ml-service/scripts/fetch-pose-model.sh` (or set "
                "POSE_LANDMARKER_MODEL_PATH) before starting the service."
            )
        options = PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(path)),
            running_mode=RunningMode.IMAGE,
        )
        self._landmarker = PoseLandmarker.create_from_options(options)

    def detect_on_image(self, image: "mp.Image") -> list[RawLandmark]:
        """Returns [] when no person is detected - callers must treat an empty
        list as "no observations", never as "person confirmed absent of joints".
        Single-person tracking only in this phase (PRD P0 scope): only the first
        detected person's landmarks are returned.
        """
        result = self._landmarker.detect(image)
        if not result.pose_landmarks:
            return []
        landmarks = result.pose_landmarks[0]
        return [
            RawLandmark(
                x=lm.x,
                y=lm.y,
                z=lm.z,
                visibility=getattr(lm, "visibility", 0.0) or 0.0,
                presence=getattr(lm, "presence", 0.0) or 0.0,
            )
            for lm in landmarks
        ]

    def close(self) -> None:
        self._landmarker.close()
