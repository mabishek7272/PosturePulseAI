"""Decoding of the LiDAR depth track uploaded beside a clip (ADR-020).

Phase 1 scope: transport only. This module reads the file, checks it against
what the sidecar declared, and produces a small transport-health block. It computes
**no metric**, emits **no MetricResult field**, and feeds nothing into the 2D
pipeline. That boundary is the point: depth must be shown to arrive and to align
before any number is derived from it, and ADR-020 is still `Proposed`.

File format (`encoding: "uint16_millimetres_deflate"`)
--------------------------------------------------

    header, 16 bytes:
        magic       8 bytes   b"BEAIVEDP"
        version     uint16    1
        width       uint16    depth map width in pixels
        height      uint16    depth map height in pixels
        flags       uint8     bit 0: a confidence plane follows each depth plane
        reserved    uint8     0

    then, per frame, in order:
        length      uint32    byte length of the zlib payload that follows
        payload     length bytes, RAW DEFLATE (RFC 1951) - no zlib header,
                    no Adler-32 trailer

    each inflated payload:
        depth       width*height uint16, little-endian, row-major,
                    millimetres along the optical axis; 0 = no return
        confidence  width*height uint8 (only when flags bit 0 is set),
                    ARKit's confidence level 0..2

The header repeats width, height and the confidence flag that the sidecar also
declares. That redundancy is deliberate: a disagreement between the file and its
description is a transport bug, and the only safe response is to refuse the
track rather than to decode it under one party's assumption.

Depth is **planar depth along the optical axis, not range along the ray** - the
convention ARKit's `sceneDepth` uses. Back-projection in Phase 2 depends on that
distinction; a range-along-ray map read as planar depth inflates every
off-centre point.
"""
from __future__ import annotations

import hashlib
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

import numpy as np

from app.geometry.intrinsics import CameraIntrinsics

MAGIC = b"BEAIVEDP"
HEADER_SIZE = 16
SUPPORTED_VERSION = 1
SUPPORTED_ENCODING = "uint16_millimetres_deflate"
FLAG_HAS_CONFIDENCE = 0x01

# Depth beyond these bounds is not a body in a clinic room: the LiDAR's usable
# range is roughly 0.25-5 m, and a reading outside it is a stray return, a
# reflection or a decode error. Used only to count plausible samples for the
# health block - never to clamp or repair a value.
MIN_PLAUSIBLE_M = 0.25
MAX_PLAUSIBLE_M = 6.0


class DepthTrackError(Exception):
    """The depth track is unusable. The clip's 2D analysis is unaffected."""


@dataclass(frozen=True)
class DepthFrame:
    """One decoded depth frame.

    `depth_m` holds metres, with `nan` wherever the sensor returned nothing. nan
    rather than 0 so that an absent return cannot be read as "the surface is at
    the camera" by any arithmetic downstream: nan propagates and numpy's
    nan-aware reductions skip it, whereas a 0 silently biases every mean.
    """

    index: int
    t: float
    depth_m: np.ndarray  # (height, width) float32, nan where there is no return
    confidence: np.ndarray | None  # (height, width) uint8, or None

    @property
    def valid_fraction(self) -> float:
        return float(np.count_nonzero(np.isfinite(self.depth_m)) / self.depth_m.size)


@dataclass(frozen=True)
class DepthTrackInfo:
    """What the sidecar declared about the depth track."""

    width: int
    height: int
    frame_count: int
    sha256: str
    has_confidence: bool
    scale_millimetres: float
    times: tuple[float, ...]


def info_from_sidecar(sidecar: Any) -> DepthTrackInfo | None:
    """The sidecar's `depth` block, or `None` when the clip carries no depth.

    `None` is the ordinary case: every clip from the non-AR capture path, and any
    AR clip recorded on hardware without a LiDAR sensor.
    """
    block = _get(sidecar, "depth")
    if block is None:
        return None

    encoding = _get(block, "encoding")
    encoding = getattr(encoding, "value", encoding)
    if encoding != SUPPORTED_ENCODING:
        raise DepthTrackError(f"unsupported depth encoding {encoding!r}")

    scale = float(_get(block, "scaleMillimetres"))
    if scale != 1.0:
        # The schema allows any positive scale so a future fixed-point format
        # does not need a new encoding name, but this reader only implements 1.
        # Refusing is the honest answer; silently assuming 1 would rescale every
        # distance by whatever the real factor was.
        raise DepthTrackError(f"depth scaleMillimetres {scale} is not supported by this reader")

    frames = _get(block, "frames") or []
    times = tuple(float(_get(f, "t")) for f in frames)
    declared_count = int(_get(block, "frameCount"))
    if declared_count != len(times):
        raise DepthTrackError(f"depth frameCount {declared_count} does not match {len(times)} frame entries")

    return DepthTrackInfo(
        width=int(_get(block, "width")),
        height=int(_get(block, "height")),
        frame_count=declared_count,
        sha256=str(_get(block, "sha256")),
        has_confidence=bool(_get(block, "hasConfidence")),
        scale_millimetres=scale,
        times=times,
    )


def read_depth_track(path: Path, info: DepthTrackInfo) -> list[DepthFrame]:
    """Decode the whole track, checking it against `info` before trusting a byte.

    Raises `DepthTrackError` for anything inconsistent. Callers treat that as
    "this clip has no depth", never as a reason to fail the clip: the 2D result
    does not depend on depth and must not be degraded by its absence.
    """
    if not path.is_file():
        raise DepthTrackError("depth file not found")

    actual_sha = _sha256_file(path)
    if actual_sha != info.sha256:
        # Checked before decoding, not after: a truncated or swapped file would
        # otherwise inflate into perfectly plausible millimetres.
        raise DepthTrackError("depth file sha256 does not match the sidecar")

    raw = path.read_bytes()
    width, height, has_confidence = _parse_header(raw, info)

    frames: list[DepthFrame] = []
    for index, payload in enumerate(_iter_payloads(raw)):
        if index >= info.frame_count:
            raise DepthTrackError(f"depth file holds more than the declared {info.frame_count} frames")
        frames.append(
            _decode_frame(
                payload,
                index=index,
                t=info.times[index],
                width=width,
                height=height,
                has_confidence=has_confidence,
            )
        )

    if len(frames) != info.frame_count:
        raise DepthTrackError(f"depth file holds {len(frames)} frames, sidecar declares {info.frame_count}")
    return frames


def _parse_header(raw: bytes, info: DepthTrackInfo) -> tuple[int, int, bool]:
    if len(raw) < HEADER_SIZE:
        raise DepthTrackError("depth file is shorter than its header")
    if raw[:8] != MAGIC:
        raise DepthTrackError("depth file does not start with the expected magic bytes")
    version, width, height, flags, _reserved = struct.unpack_from("<HHHBB", raw, 8)
    if version != SUPPORTED_VERSION:
        raise DepthTrackError(f"depth file format version {version} is not supported")
    has_confidence = bool(flags & FLAG_HAS_CONFIDENCE)
    if (width, height) != (info.width, info.height):
        raise DepthTrackError(
            f"depth file is {width}x{height} but the sidecar declares {info.width}x{info.height}"
        )
    if has_confidence != info.has_confidence:
        raise DepthTrackError("depth file and sidecar disagree about whether a confidence plane is present")
    return width, height, has_confidence


def _iter_payloads(raw: bytes) -> Iterator[bytes]:
    offset = HEADER_SIZE
    total = len(raw)
    while offset < total:
        if total - offset < 4:
            raise DepthTrackError("depth file ends inside a frame length")
        (length,) = struct.unpack_from("<I", raw, offset)
        offset += 4
        if length == 0 or total - offset < length:
            raise DepthTrackError("depth file ends inside a frame payload")
        yield raw[offset : offset + length]
        offset += length


def _decode_frame(
    payload: bytes, *, index: int, t: float, width: int, height: int, has_confidence: bool
) -> DepthFrame:
    try:
        # wbits=-15: raw DEFLATE, no zlib wrapper. This is what Apple's
        # Compression framework produces for COMPRESSION_ZLIB, which is what the
        # iOS writer uses; plain zlib.decompress would reject every frame here
        # because it would look for a two-byte header that was never written.
        flat = zlib.decompress(payload, -zlib.MAX_WBITS)
    except zlib.error as exc:
        raise DepthTrackError(f"depth frame {index} could not be inflated: {exc}") from exc

    pixels = width * height
    expected = pixels * 2 + (pixels if has_confidence else 0)
    if len(flat) != expected:
        raise DepthTrackError(f"depth frame {index} inflated to {len(flat)} bytes, expected {expected}")

    millimetres = np.frombuffer(flat, dtype="<u2", count=pixels).reshape(height, width)
    depth_m = millimetres.astype(np.float32) / 1000.0
    # 0 means "no return", which is not 0 m. Replacing it with nan here, once, is
    # what keeps every later reduction from averaging in a non-measurement.
    depth_m[millimetres == 0] = np.nan

    confidence = None
    if has_confidence:
        confidence = np.frombuffer(flat, dtype=np.uint8, count=pixels, offset=pixels * 2).reshape(height, width)

    return DepthFrame(index=index, t=t, depth_m=depth_m, confidence=confidence)


def nearest_frame(frames: list[DepthFrame], t: float) -> DepthFrame | None:
    """The depth frame closest in time to `t`, or `None` when there are none.

    No tolerance is applied here; the caller decides how stale a pairing it will
    accept. Depth arrives at ~15 Hz against video at 30-60 Hz, and frames drop,
    so gaps are expected and are never filled by interpolation: an interpolated
    depth frame is a fabricated measurement (CLAUDE.md rule 3).
    """
    if not frames:
        return None
    return min(frames, key=lambda f: abs(f.t - t))


def depth_health(
    frames: list[DepthFrame],
    *,
    intrinsics: CameraIntrinsics | None,
    hip_pixels: tuple[float, float] | None,
    video_size: tuple[int, int],
) -> dict:
    """A transport-health block for the analysis response. Not a measurement.

    Every value here answers "did the depth track arrive intact and line up with
    the video?", and none of it is reported to a clinician or a patient. In
    particular `medianHipDepthMetres` exists to be compared against the AR jig's
    own on-device distance reading: they are two independent measurements of the
    same quantity, so a disagreement means the pixel alignment is wrong. It is
    deliberately not a `static3d.` metric and carries no uncertainty, because
    nothing has established what its uncertainty is.
    """
    health: dict[str, Any] = {
        "frameCount": len(frames),
        "hasConfidence": bool(frames and frames[0].confidence is not None),
        "intrinsicsPresent": intrinsics is not None,
    }

    if frames:
        valid = [f.valid_fraction for f in frames]
        health["validSampleFraction"] = round(float(np.mean(valid)), 4)
        plausible = [_plausible_fraction(f) for f in frames]
        health["plausibleSampleFraction"] = round(float(np.mean(plausible)), 4)
        health["firstFrameT"] = round(frames[0].t, 4)
        health["lastFrameT"] = round(frames[-1].t, 4)

    if intrinsics is not None:
        depth_intrinsics = intrinsics.rescaled_to(frames[0].depth_m.shape[1], frames[0].depth_m.shape[0]) if frames else None
        health["intrinsics"] = {
            "video": {"fx": intrinsics.fx, "fy": intrinsics.fy, "cx": intrinsics.cx, "cy": intrinsics.cy},
        }
        if depth_intrinsics is not None:
            health["intrinsics"]["depth"] = {
                "fx": depth_intrinsics.fx,
                "fy": depth_intrinsics.fy,
                "cx": depth_intrinsics.cx,
                "cy": depth_intrinsics.cy,
            }

    hip_depth = _median_hip_depth(frames, hip_pixels=hip_pixels, video_size=video_size)
    if hip_depth is not None:
        health["medianHipDepthMetres"] = round(hip_depth, 3)
    return health


def _plausible_fraction(frame: DepthFrame) -> float:
    d = frame.depth_m
    return float(np.count_nonzero((d >= MIN_PLAUSIBLE_M) & (d <= MAX_PLAUSIBLE_M)) / d.size)


def _median_hip_depth(
    frames: list[DepthFrame], *, hip_pixels: tuple[float, float] | None, video_size: tuple[int, int]
) -> float | None:
    """Median depth in a small patch at the mid-hip, across all depth frames.

    The hip is used because it is the most reliably depth-sampled landmark on a
    standing subject: it sits on a broad, near-frontal surface, so a patch there
    contains several real LiDAR returns rather than the interpolation that a
    heel-sized patch would (ADR-020 section 4). Returns `None` rather than a
    number whenever there is nothing to measure.
    """
    if not frames or hip_pixels is None:
        return None
    video_w, video_h = video_size
    if video_w < 1 or video_h < 1:
        return None

    height, width = frames[0].depth_m.shape
    # Map video pixel -> depth pixel with the same pixel-centre convention the
    # intrinsics use, so the two cannot drift apart by half a pixel.
    u = (hip_pixels[0] + 0.5) * width / video_w - 0.5
    v = (hip_pixels[1] + 0.5) * height / video_h - 0.5
    radius = 3  # +-3 depth px ~ 8 cm at 2.5 m: wide enough to hold real returns.
    u0, u1 = int(round(u)) - radius, int(round(u)) + radius + 1
    v0, v1 = int(round(v)) - radius, int(round(v)) + radius + 1
    if u1 <= 0 or v1 <= 0 or u0 >= width or v0 >= height:
        return None
    u0, v0 = max(0, u0), max(0, v0)
    u1, v1 = min(width, u1), min(height, v1)

    samples: list[float] = []
    for frame in frames:
        patch = frame.depth_m[v0:v1, u0:u1]
        finite = patch[np.isfinite(patch)]
        finite = finite[(finite >= MIN_PLAUSIBLE_M) & (finite <= MAX_PLAUSIBLE_M)]
        if finite.size == 0:
            continue
        samples.append(float(np.median(finite)))
    if not samples:
        return None
    return float(np.median(samples))


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _get(obj: Any, name: str) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)
