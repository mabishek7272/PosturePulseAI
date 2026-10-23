"""Registry and per-frame math for the static-battery metrics
(docs/superpowers/specs/2026-10-23-m1-static-battery.md, Slice A).

All geometry runs on roll-corrected pixel points (x right, y down, gravity
along +y), so "vertical" is true vertical. Person-left / person-right are
MediaPipe's own labels. Nothing here classifies a value: each metric returns a
signed number with an uncertainty, and the sign convention is part of the
registry entry (CLAUDE.md rules 1 and 3).

Uncertainty model (DRAFT - engineering defaults, not derived from data; revisit
with Study A):
  * per-landmark position SD   sigma_p = 0.01 * H / max(visibility, 0.5),
    where H is the clip's body height in pixels (nose to heel);
  * a line or segment angle    sigma_theta = sqrt(sigma_a^2 + sigma_b^2) / L
    (radians -> degrees), which is sqrt(2) * sigma_p / L for equal landmarks;
  * a three-point (knee) angle combines its two segments in quadrature;
  * a percent_stature offset   sqrt(sigma_a^2 + sigma_b^2) / H * 100;
  * across frames, `aggregate` combines the mean model variance with the
    between-frame spread 1.4826 * MAD: sqrt(sigma_model^2 + sigma_spread^2).
    Landmark errors are largely systematic between frames, so averaging frames
    is deliberately NOT allowed to shrink sigma_model.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable

import numpy as np

from app.clips.observation import NOSE, SIDE_LANDMARKS

POSITION_SD_FRACTION = 0.01
MIN_VARIANCE_VISIBILITY = 0.5
MAD_TO_SD = 1.4826

FRONTAL = ("anterior", "posterior")
LATERAL = ("left_lateral", "right_lateral")

L_SH, R_SH = SIDE_LANDMARKS["left"]["shoulder"], SIDE_LANDMARKS["right"]["shoulder"]
L_HIP, R_HIP = SIDE_LANDMARKS["left"]["hip"], SIDE_LANDMARKS["right"]["hip"]
L_ANK, R_ANK = SIDE_LANDMARKS["left"]["ankle"], SIDE_LANDMARKS["right"]["ankle"]
L_EAR, R_EAR = SIDE_LANDMARKS["left"]["ear"], SIDE_LANDMARKS["right"]["ear"]


@dataclass(frozen=True)
class ClipContext:
    """Clip-level quantities the per-frame functions need."""

    view: str
    body_height: float  # H, pixels
    s_lat: int  # +1 anterior, -1 posterior (0 for lateral views)
    near_side: str | None  # lateral views: "left" / "right"
    s_fwd: int  # lateral views: +1 if the nose is at larger image x than the ear, else -1


# (value, sigma) for one frame, or None when the frame is geometrically degenerate.
FrameResult = tuple[float, float] | None
FrameFn = Callable[[ClipContext, np.ndarray, np.ndarray, "str | None"], FrameResult]


@dataclass(frozen=True)
class MetricDef:
    key: str
    label: str
    tier: str  # "estimate" | "proxy"
    unit: str  # "deg" | "percent_stature"
    views: tuple[str, ...]
    sides: str  # "none" (one result), "both" (left+right, frontal), "near" (lateral near side)
    sign_convention: str
    description: str
    compute: FrameFn
    module: str = "static"


def _deg(rad: float) -> float:
    return math.degrees(rad)


def _mid(p: np.ndarray, a: int, b: int) -> np.ndarray:
    return (p[a] + p[b]) / 2.0


def _mid_sigma(s: np.ndarray, a: int, b: int) -> float:
    return math.hypot(s[a], s[b]) / 2.0


def _pct(ctx: ClipContext, value_px: float, sigma_px: float) -> tuple[float, float]:
    return value_px / ctx.body_height * 100.0, sigma_px / ctx.body_height * 100.0


def _knee_deviation(p: np.ndarray, s: np.ndarray, hip: int, knee: int, ankle: int):
    """(magnitude, sigma, horizontal offset of the knee from the hip-ankle line),
    magnitude = 180 deg - angle(hip, knee, ankle). None when degenerate."""
    v1, v2 = p[hip] - p[knee], p[ankle] - p[knee]
    l1, l2 = float(np.hypot(*v1)), float(np.hypot(*v2))
    dy = p[ankle][1] - p[hip][1]
    if l1 < 1e-6 or l2 < 1e-6 or abs(dy) < 1e-6:
        return None
    cos = float(np.clip(np.dot(v1, v2) / (l1 * l2), -1.0, 1.0))
    magnitude = 180.0 - _deg(math.acos(cos))
    sigma = _deg(math.hypot(math.hypot(s[hip], s[knee]) / l1, math.hypot(s[knee], s[ankle]) / l2))
    x_line = p[hip][0] + (p[ankle][0] - p[hip][0]) * (p[knee][1] - p[hip][1]) / dy
    return magnitude, sigma, float(p[knee][0] - x_line)


# ---- per-frame functions ------------------------------------------------------------------


def _line_tilt(left: int, right: int) -> FrameFn:
    def fn(ctx, p, s, side):
        dx = abs(p[left][0] - p[right][0])
        dy = p[left][1] - p[right][1]
        length = math.hypot(dx, dy)
        if length < 1e-6:
            return None
        return _deg(math.atan2(dy, dx)), _deg(math.hypot(s[left], s[right]) / length)

    return fn


def _trunk_lateral_lean(ctx, p, s, side):
    sm, hm = _mid(p, L_SH, R_SH), _mid(p, L_HIP, R_HIP)
    vx, up = sm[0] - hm[0], hm[1] - sm[1]
    length = math.hypot(vx, up)
    if up <= 0 or length < 1e-6:
        return None
    sigma = math.hypot(_mid_sigma(s, L_SH, R_SH), _mid_sigma(s, L_HIP, R_HIP))
    return _deg(math.atan2(vx * ctx.s_lat, up)), _deg(sigma / length)


def _lateral_body_shift(ctx, p, s, side):
    sm, am = _mid(p, L_SH, R_SH), _mid(p, L_ANK, R_ANK)
    sigma = math.hypot(_mid_sigma(s, L_SH, R_SH), _mid_sigma(s, L_ANK, R_ANK))
    return _pct(ctx, (sm[0] - am[0]) * ctx.s_lat, sigma)


def _knee_frontal_alignment(ctx, p, s, side):
    lm = SIDE_LANDMARKS[side]
    dev = _knee_deviation(p, s, lm["hip"], lm["knee"], lm["ankle"])
    toward = float(np.sign(_mid(p, L_HIP, R_HIP)[0] - p[lm["hip"]][0]))
    if dev is None or toward == 0.0:
        return None
    magnitude, sigma, offset = dev
    return (magnitude if offset * toward > 0 else -magnitude), sigma


def _plumb_offset(part: str) -> FrameFn:
    def fn(ctx, p, s, side):
        lm = SIDE_LANDMARKS[side]
        sigma = math.hypot(s[lm[part]], s[lm["ankle"]])
        return _pct(ctx, (p[lm[part]][0] - p[lm["ankle"]][0]) * ctx.s_fwd, sigma)

    return fn


def _head_shoulder_angle(ctx, p, s, side):
    lm = SIDE_LANDMARKS[side]
    up = p[lm["shoulder"]][1] - p[lm["ear"]][1]
    fwd = (p[lm["ear"]][0] - p[lm["shoulder"]][0]) * ctx.s_fwd
    length = math.hypot(up, fwd)
    if up <= 0 or length < 1e-6:
        return None
    return _deg(math.atan2(up, fwd)), _deg(math.hypot(s[lm["ear"]], s[lm["shoulder"]]) / length)


def _trunk_inclination(ctx, p, s, side):
    lm = SIDE_LANDMARKS[side]
    fwd = (p[lm["shoulder"]][0] - p[lm["hip"]][0]) * ctx.s_fwd
    up = p[lm["hip"]][1] - p[lm["shoulder"]][1]
    length = math.hypot(up, fwd)
    if up <= 0 or length < 1e-6:
        return None
    return _deg(math.atan2(fwd, up)), _deg(math.hypot(s[lm["shoulder"]], s[lm["hip"]]) / length)


def _knee_extension(ctx, p, s, side):
    lm = SIDE_LANDMARKS[side]
    dev = _knee_deviation(p, s, lm["hip"], lm["knee"], lm["ankle"])
    if dev is None:
        return None
    magnitude, sigma, offset = dev
    # Knee behind (posterior to) the hip-ankle line -> extended beyond straight (+).
    return (magnitude if offset * ctx.s_fwd < 0 else -magnitude), sigma


_STATURE = " Percent of stature: percent of H, the vertical distance from the nose to the heel(s), in pixels."

STATIC_METRICS: dict[str, MetricDef] = {
    d.key: d
    for d in [
        MetricDef(
            "static.head_lateral_tilt", "Head lateral tilt", "estimate", "deg", FRONTAL, "none",
            "positive = person's left ear lower than the right",
            "Angle of the line between the ears from horizontal, from the front or back view.",
            _line_tilt(L_EAR, R_EAR),
        ),
        MetricDef(
            "static.shoulder_line_tilt", "Shoulder line tilt", "proxy", "deg", FRONTAL, "none",
            "positive = person's left shoulder lower than the right",
            "Angle of the line between the shoulder landmarks from horizontal, from the front or back view.",
            _line_tilt(L_SH, R_SH),
        ),
        MetricDef(
            "static.hip_line_tilt", "Hip line tilt", "proxy", "deg", FRONTAL, "none",
            "positive = person's left hip landmark lower than the right",
            "Angle of the line between the hip landmarks from horizontal, from the front or back view.",
            _line_tilt(L_HIP, R_HIP),
        ),
        MetricDef(
            "static.trunk_lateral_lean", "Trunk lateral lean", "estimate", "deg", FRONTAL, "none",
            "positive = trunk leans toward the person's left",
            "Angle from vertical of the line from the hip midpoint to the shoulder midpoint, sideways component.",
            _trunk_lateral_lean,
        ),
        MetricDef(
            "static.lateral_body_shift", "Lateral body shift", "estimate", "percent_stature", ("anterior",), "none",
            "positive = shoulder midpoint is toward the person's left of the ankle midpoint",
            "Sideways offset of the shoulder midpoint from the ankle midpoint." + _STATURE,
            _lateral_body_shift,
        ),
        MetricDef(
            "static.knee_frontal_alignment", "Knee frontal alignment", "proxy", "deg", ("anterior",), "both",
            "positive = knee is displaced toward the midline from the hip-ankle line",
            "180 degrees minus the hip-knee-ankle angle in the front view, one result per leg.",
            _knee_frontal_alignment,
        ),
        *[
            MetricDef(
                f"static.plumb_offset_{part}", f"{part.capitalize()} offset from ankle", "estimate",
                "percent_stature", LATERAL, "near",
                "positive = landmark is anterior (toward the direction the person faces) of the ankle",
                f"Forward offset of the {part} from the ankle landmark, nearer side." + _STATURE,
                _plumb_offset(part),
            )
            for part in ("ear", "shoulder", "hip", "knee")
        ],
        MetricDef(
            "static.head_shoulder_angle", "Head-shoulder angle", "proxy", "deg", LATERAL, "near",
            "angle of the shoulder-to-ear line above horizontal, measured from the forward direction; "
            "90 = ear directly above the shoulder, smaller = ear further forward",
            "Angle of the line from the shoulder to the ear above horizontal, nearer side.",
            _head_shoulder_angle,
        ),
        MetricDef(
            "static.trunk_inclination", "Trunk inclination", "estimate", "deg", LATERAL, "near",
            "positive = shoulder is forward of the hip (toward the direction the person faces)",
            "Angle from vertical of the line from the hip to the shoulder, nearer side.",
            _trunk_inclination,
        ),
        MetricDef(
            "static.knee_extension", "Knee extension", "estimate", "deg", LATERAL, "near",
            "positive = knee is behind the hip-ankle line (extended beyond straight)",
            "180 degrees minus the hip-knee-ankle angle in the side view, nearer side.",
            _knee_extension,
        ),
    ]
}


def result_sides(definition: MetricDef, view: str) -> list[str | None]:
    """The `side` values a metric yields for a clip of `view`."""
    if view not in definition.views:
        return [None]
    if definition.sides == "both":
        return ["left", "right"]
    if definition.sides == "near":
        return ["left" if view == "left_lateral" else "right"]
    return [None]


def frame_sigmas(visibility: np.ndarray, body_height: float) -> np.ndarray:
    """Per-landmark position SD in pixels (draft model, see module docstring)."""
    return POSITION_SD_FRACTION * body_height / np.maximum(visibility, MIN_VARIANCE_VISIBILITY)


def aggregate(values: np.ndarray, sigmas: np.ndarray) -> tuple[float, float]:
    """Median over frames, with sqrt(mean per-frame model variance + (1.4826*MAD)^2)."""
    values = np.asarray(values, dtype=float)
    sigmas = np.asarray(sigmas, dtype=float)
    median = float(np.median(values))
    spread = MAD_TO_SD * float(np.median(np.abs(values - median)))
    model = float(np.sqrt(np.mean(sigmas**2)))
    return median, math.sqrt(model**2 + spread**2)
