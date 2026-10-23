"""Observations -> metric outcomes for one static-hold clip (no video, no I/O).

Every requested metric key yields exactly one outcome per side: an estimate
(value + uncertainty) or an explicit `unsupported` with reasons. Nothing is
guessed or dropped (CLAUDE.md rule 3). A clip-level quality failure makes every
metric of the clip unsupported with the same reasons.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from app.clips.observation import NOSE, SIDE_LANDMARKS, FrameObservation
from app.metrics.static_metrics import (
    STATIC_METRICS,
    ClipContext,
    aggregate,
    frame_sigmas,
    result_sides,
)
from app.quality.clip_quality import ClipQuality, assess_clip, near_side

# Reported uncertainty is rounded UP to this step, never down.
UNCERTAINTY_STEP = 0.01
VALUE_DECIMALS = 3


class UnknownMetricError(ValueError):
    """A requested metricKey is not in the static-metric registry."""


@dataclass
class MetricOutcome:
    metric_key: str
    side: str | None
    module: str
    tier: str
    unit: str
    sign_convention: str
    value: float | None = None
    uncertainty: float | None = None
    frames_used: int = 0
    frame_indices: list[int] = field(default_factory=list)
    reasons: list[str] | None = None  # set <=> unsupported


@dataclass
class AnalysisOutcome:
    metrics: list[MetricOutcome]
    quality: ClipQuality

    @property
    def frame_quality(self) -> dict:
        """`usable` / `total` count the frames of the hold (the first second,
        which the guidance leaves for settling, is not counted)."""
        return {
            "usable": len(self.quality.usable_indices),
            "total": self.quality.expected_frames,
            "reasons": list(self.quality.clip_reasons),
        }


def _unsupported(definition, side, reasons: list[str]) -> MetricOutcome:
    return MetricOutcome(
        definition.key, side, definition.module, definition.tier, definition.unit,
        definition.sign_convention, reasons=list(reasons),
    )


def _forward_sign(observations, quality: ClipQuality, side: str) -> int:
    """+1 if the nose is at larger image x than the near-side ear, else -1 (0 if undecidable)."""
    ear = SIDE_LANDMARKS[side]["ear"]
    dx = [quality.corrected_points[p][NOSE][0] - quality.corrected_points[p][ear][0] for p in quality.usable_indices]
    return int(np.sign(np.median(dx))) if dx else 0


def analyze_observations(
    observations: list[FrameObservation],
    *,
    view: str,
    width: int,
    height: int,
    metric_keys: list[str],
    min_fps: float,
    level_tolerance_degrees: float,
) -> AnalysisOutcome:
    keys = list(dict.fromkeys(metric_keys))
    unknown = [k for k in keys if k not in STATIC_METRICS]
    if unknown:
        raise UnknownMetricError(f"unknown metric keys: {unknown}")

    quality = assess_clip(
        observations, view=view, width=width, height=height,
        min_fps=min_fps, level_tolerance_degrees=level_tolerance_degrees,
    )
    clip_ok = not quality.clip_reasons
    ctx: ClipContext | None = None
    if clip_ok:
        side = near_side(view)
        s_fwd = _forward_sign(observations, quality, side) if side else 0
        if side and s_fwd == 0:
            # Nose directly over the ear: facing direction cannot be told.
            quality.clip_reasons.append("wrong_view")
            clip_ok = False
        else:
            ctx = ClipContext(
                view=view,
                body_height=quality.body_height,
                s_lat=(1 if view == "anterior" else -1) if side is None else 0,
                near_side=side,
                s_fwd=s_fwd,
            )

    outcomes: list[MetricOutcome] = []
    for key in keys:
        definition = STATIC_METRICS[key]
        for side in result_sides(definition, view):
            if view not in definition.views:
                outcomes.append(_unsupported(definition, side, ["wrong_view"]))
            elif not clip_ok:
                outcomes.append(_unsupported(definition, side, quality.clip_reasons))
            else:
                outcomes.append(_measure(definition, side, ctx, observations, quality))
    return AnalysisOutcome(outcomes, quality)


def _measure(definition, side, ctx: ClipContext, observations, quality: ClipQuality) -> MetricOutcome:
    values, sigmas, used = [], [], []
    for pos in quality.usable_indices:
        points = quality.corrected_points[pos]
        sig = frame_sigmas(observations[pos].visibility, ctx.body_height)
        result = definition.compute(ctx, points, sig, side)
        if result is None:
            continue
        values.append(result[0])
        sigmas.append(result[1])
        used.append(observations[pos].index)
    if not values:
        return _unsupported(definition, side, ["insufficient_landmarks"])
    value, uncertainty = aggregate(np.array(values), np.array(sigmas))
    return MetricOutcome(
        definition.key, side, definition.module, definition.tier, definition.unit,
        definition.sign_convention,
        value=round(value, VALUE_DECIMALS),
        uncertainty=round(math.ceil(uncertainty / UNCERTAINTY_STEP) * UNCERTAINTY_STEP, 2),
        frames_used=len(values),
        frame_indices=used,
    )
