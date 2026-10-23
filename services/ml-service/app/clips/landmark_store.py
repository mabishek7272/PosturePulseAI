"""Stores the per-frame landmark series of an analysed clip as gzip JSON under
`<clip dir>/landmarks/<clipId>.json.gz`, so every reported number can be traced
back to (and re-computed from) the landmarks it came from.

Points are pixel coordinates of the oriented image BEFORE roll correction
(MediaPipe x*width, y*height). Frames with no detected pose store `null`
points - never zeros. The gzip header carries no timestamp, so identical input
gives identical bytes and a stable sha256.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import re
from pathlib import Path

from app.clips.observation import FrameObservation

SERIES_VERSION = "landmark-series/v1"
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")


def store_landmark_series(
    clip_dir: Path,
    *,
    clip_id: str,
    session_id: str,
    step_id: str,
    view: str,
    width: int,
    height: int,
    model_version: str,
    observations: list[FrameObservation],
) -> dict[str, str]:
    if not _SAFE_ID.match(clip_id) or ".." in clip_id:
        raise ValueError(f"unsafe clip id {clip_id!r}")
    body = {
        "version": SERIES_VERSION,
        "clipId": clip_id,
        "sessionId": session_id,
        "stepId": step_id,
        "view": view,
        "width": width,
        "height": height,
        "modelVersion": model_version,
        "coordinateSpace": "oriented image pixels (x right, y down), before roll correction",
        "frames": [
            {
                "index": o.index,
                "t": o.t,
                "gravity": list(o.gravity),
                "points": None if o.points is None else [[round(float(x), 2), round(float(y), 2)] for x, y in o.points],
                "visibility": None if o.visibility is None else [round(float(v), 3) for v in o.visibility],
            }
            for o in observations
        ],
    }
    raw = json.dumps(body, separators=(",", ":")).encode()
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
        gz.write(raw)
    data = buf.getvalue()

    target_dir = Path(clip_dir) / "landmarks"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{clip_id}.json.gz"
    tmp = target.with_name(target.name + ".part")
    tmp.write_bytes(data)
    tmp.replace(target)
    return {"path": str(target), "sha256": hashlib.sha256(data).hexdigest()}
