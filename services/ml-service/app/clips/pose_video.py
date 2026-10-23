"""Decodes an assessment clip with PyAV and runs the FULL MediaPipe
PoseLandmarker over it in VIDEO mode, using the sidecar's frame timestamps.

Decoded frame i is paired with sidecar frame i (the app writes one sidecar entry
per encoded frame, in order). Landmarks become pixel coordinates of the
oriented image (x*width, y*height). A frame with no detected pose keeps
`points=None` - nothing is filled in (CLAUDE.md rule 3). Any decode problem,
including a decoded size that disagrees with the sidecar, raises
ClipDecodeError so the clip is reported as unsupported rather than guessed.
"""
from __future__ import annotations

from pathlib import Path

import av
import mediapipe as mp
import numpy as np
from beaive_schemas import ClipCapture
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import PoseLandmarker, PoseLandmarkerOptions, RunningMode

from app.clips.errors import ClipDecodeError, PoseModelUnavailableError
from app.clips.observation import NUM_LANDMARKS, FrameObservation
from app.config import POSE_LANDMARKER_FULL_MODEL_PATH


def apply_rotation(arr: np.ndarray, rotation_degrees: float) -> np.ndarray:
    """Applies the container's display-matrix rotation (counterclockwise
    degrees, as FFmpeg reports it) so the array matches the oriented image."""
    quarter_turns = rotation_degrees / 90.0
    if quarter_turns != round(quarter_turns):
        raise ClipDecodeError(f"unsupported clip rotation {rotation_degrees}")
    return np.rot90(arr, int(round(quarter_turns)) % 4)


def _decoded_frames(path: Path, width: int, height: int):
    try:
        with av.open(str(path)) as container:
            stream = next((s for s in container.streams if s.type == "video"), None)
            if stream is None:
                raise ClipDecodeError("no video stream")
            for frame in container.decode(stream):
                arr = frame.to_ndarray(format="rgb24")
                rotation = getattr(frame, "rotation", 0) or 0
                if rotation:
                    arr = apply_rotation(arr, rotation)
                if arr.shape[0] != height or arr.shape[1] != width:
                    raise ClipDecodeError(
                        f"decoded frame is {arr.shape[1]}x{arr.shape[0]}, sidecar says {width}x{height}"
                    )
                yield np.ascontiguousarray(arr)
    except (av.error.FFmpegError, OSError, ValueError) as exc:
        raise ClipDecodeError(str(exc)) from exc


def _landmarker() -> PoseLandmarker:
    path = POSE_LANDMARKER_FULL_MODEL_PATH
    if not path.exists():
        raise PoseModelUnavailableError(
            f"Full pose landmarker model not found at {path}. Run scripts/fetch-pose-model.sh "
            "(or set POSE_LANDMARKER_FULL_MODEL_PATH)."
        )
    return PoseLandmarker.create_from_options(
        PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(path)),
            running_mode=RunningMode.VIDEO,
            num_poses=1,
        )
    )


def load_observations(clip_path: Path, sidecar: ClipCapture) -> list[FrameObservation]:
    """One FrameObservation per sidecar frame, in order."""
    width, height = sidecar.width, sidecar.height
    observations = [
        FrameObservation(index=f.index, t=float(f.t), gravity=tuple(float(g) for g in f.gravity))
        for f in sidecar.frames
    ]
    landmarker = _landmarker()
    try:
        last_ts = -1
        for i, arr in enumerate(_decoded_frames(clip_path, width, height)):
            if i >= len(observations):
                break  # more encoded frames than sidecar entries: the extras have no timing
            ts = max(int(round(observations[i].t * 1000)), last_ts + 1)  # VIDEO mode needs increasing ms
            last_ts = ts
            try:
                result = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=arr), ts)
            except RuntimeError:
                continue  # leave this frame without a pose
            if not result.pose_landmarks:
                continue
            lms = result.pose_landmarks[0]
            if len(lms) != NUM_LANDMARKS:
                continue
            observations[i].points = np.array([[lm.x * width, lm.y * height] for lm in lms], dtype=float)
            observations[i].visibility = np.array([getattr(lm, "visibility", 0.0) or 0.0 for lm in lms], dtype=float)
    finally:
        landmarker.close()
    return observations
