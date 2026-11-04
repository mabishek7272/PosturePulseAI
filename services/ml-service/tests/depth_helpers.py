"""Builders for the depth track described in app/clips/depth_track.py.

This is the only writer of the format in the Python tree, and it is deliberately
written from the format documentation rather than by importing the reader's
constants for the layout: a test that encodes with the decoder's own arithmetic
cannot catch a decoder that reads the layout wrongly. The reader's magic bytes
and flag value are imported, since those are identity, not layout.
"""
from __future__ import annotations

import hashlib
import struct
import zlib
from pathlib import Path

import numpy as np

from app.clips.depth_track import FLAG_HAS_CONFIDENCE, MAGIC


def encode_depth_file(
    path: Path,
    frames_mm: list[np.ndarray],
    *,
    confidence: list[np.ndarray] | None = None,
    version: int = 1,
    width: int | None = None,
    height: int | None = None,
) -> Path:
    """Write `frames_mm` (each (h, w) uint16 millimetres, 0 = no return) to `path`.

    `width`/`height` override what goes in the header, so a test can write a
    header that disagrees with the sidecar on purpose.
    """
    h, w = frames_mm[0].shape
    flags = FLAG_HAS_CONFIDENCE if confidence is not None else 0
    out = bytearray(MAGIC)
    out += struct.pack("<HHHBB", version, width if width is not None else w, height if height is not None else h, flags, 0)
    for i, frame in enumerate(frames_mm):
        payload = frame.astype("<u2").tobytes()
        if confidence is not None:
            payload += confidence[i].astype(np.uint8).tobytes()
        # Raw DEFLATE, matching what the iOS writer emits via Apple's
        # Compression framework. A zlib-wrapped blob here would make the decoder
        # tests pass against bytes the device never produces.
        deflate = zlib.compressobj(wbits=-zlib.MAX_WBITS)
        blob = deflate.compress(payload) + deflate.flush()
        out += struct.pack("<I", len(blob)) + blob
    path.write_bytes(bytes(out))
    return path


def depth_sidecar_block(path: Path, frames_mm: list[np.ndarray], *, fps: float = 15.0, has_confidence: bool = False, **overrides) -> dict:
    """The `depth` block of a sidecar describing the file at `path`."""
    h, w = frames_mm[0].shape
    block = {
        "width": w,
        "height": h,
        "encoding": "uint16_millimetres_deflate",
        "scaleMillimetres": 1,
        "nominalFps": fps,
        "frameCount": len(frames_mm),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "hasConfidence": has_confidence,
        "frames": [{"index": i, "t": i / fps} for i in range(len(frames_mm))],
    }
    block.update(overrides)
    return block


def flat_depth_mm(distance_m: float, *, w: int = 256, h: int = 192, valid: float = 1.0) -> np.ndarray:
    """A frame where every pixel reads `distance_m`, with the first `1 - valid`
    of the pixels zeroed to stand in for pixels the sensor did not return."""
    frame = np.full((h, w), int(round(distance_m * 1000)), dtype=np.uint16)
    missing = int(round(frame.size * (1.0 - valid)))
    if missing:
        frame.reshape(-1)[:missing] = 0
    return frame
