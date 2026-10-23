"""Shared builders for clip-analysis API/service tests."""
from __future__ import annotations

from datetime import datetime, timezone

from synthetic_pose import HEIGHT, WIDTH


def sidecar(
    clip_id: str = "clip-1",
    session_id: str = "sess-1",
    step_id: str = "static.anterior",
    view: str = "anterior",
    n: int = 60,
    fps: float = 30.0,
    width: int = WIDTH,
    height: int = HEIGHT,
    gravity=(0.0, 1.0, 0.0),
) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "clipId": clip_id,
        "sessionId": session_id,
        "stepId": step_id,
        "view": view,
        "recordedAt": now,
        "nominalFps": fps,
        "width": width,
        "height": height,
        "frames": [{"index": i, "t": i / fps, "gravity": list(gravity)} for i in range(n)],
        "device": {"model": "iPad16,2", "lens": "back_wide", "appVersion": "1.0.0"},
        "provenance": {
            "schemaVersion": "clip-capture/v0",
            "modelVersion": "ios-capture/test",
            "calibrationVersion": "none/v0",
            "producedAt": now,
        },
    }


ANTERIOR_KEYS = [
    "static.head_lateral_tilt",
    "static.shoulder_line_tilt",
    "static.hip_line_tilt",
    "static.trunk_lateral_lean",
    "static.lateral_body_shift",
    "static.knee_frontal_alignment",
]


def request_body(clip_path: str, side: dict | None = None, keys=None, **extra) -> dict:
    return {
        "sessionId": (side or {}).get("sessionId", "sess-1"),
        "clipId": (side or {}).get("clipId", "clip-1"),
        "stepId": (side or {}).get("stepId", "static.anterior"),
        "clipPath": clip_path,
        "sidecar": side or sidecar(),
        "metricKeys": keys if keys is not None else ANTERIOR_KEYS,
        "minFps": 24,
        "levelToleranceDegrees": 3,
        **extra,
    }
