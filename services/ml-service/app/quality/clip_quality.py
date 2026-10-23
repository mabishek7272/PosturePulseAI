"""Frame-level, then step-level quality checks for a static-hold assessment
clip (docs/superpowers/specs/2026-10-23-m1-static-battery.md, Slice A).

CLAUDE.md rule 3: when a check fails the clip yields explicit reasons and the
metrics are reported as `unsupported` - nothing is guessed or silently dropped.

Thresholds are the spec's draft values - engineering defaults, not clinically
or empirically derived; revisit with Study A data.
"""
from __future__ import annotations

import statistics
from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from app.clips.observation import NOSE, SIDE_LANDMARKS, FrameObservation
from app.geometry.roll_correction import correct_roll, pitch_degrees

MIN_VISIBILITY = 0.5
FRAME_MARGIN_FRACTION = 0.02
HOLD_SKIP_SECONDS = 1.0
MIN_USABLE_FRAMES = 10
MIN_USABLE_FRACTION = 0.5
LATERAL_MAX_SHOULDER_WIDTH_RATIO = 0.35
MAX_HIP_SD_FRACTION = 0.02
# A frame-level reason is reported for the clip when it affected at least this
# share of the hold's frames (the most frequent one is always reported).
REPORT_FRAME_REASON_FRACTION = 0.10

FRONTAL_VIEWS = ("anterior", "posterior")
LATERAL_VIEWS = ("left_lateral", "right_lateral")


def near_side(view: str) -> str | None:
    """Person side facing the camera in a lateral view (None for frontal)."""
    if view == "left_lateral":
        return "left"
    if view == "right_lateral":
        return "right"
    return None


def required_landmarks(view: str) -> list[int]:
    """Landmarks that must be visible and in frame for a frame to be usable:
    everything any metric of the view or the body-height scale uses."""
    if view in FRONTAL_VIEWS:
        parts = ("ear", "shoulder", "hip", "knee", "ankle", "heel")
        return [NOSE] + [SIDE_LANDMARKS[s][p] for s in ("left", "right") for p in parts]
    side = near_side(view)
    if side is None:
        raise ValueError(f"unknown view {view!r}")
    return [NOSE] + list(SIDE_LANDMARKS[side].values())


@dataclass
class FrameQuality:
    index: int
    t: float
    status: str  # "skipped" (inside the first second), "usable" or "unusable"
    reasons: list[str] = field(default_factory=list)


@dataclass
class ClipQuality:
    view: str
    frames: list[FrameQuality]
    # Positions (into the observation list) of usable frames.
    usable_indices: list[int]
    # Roll-corrected points per observation (None where no pose).
    corrected_points: list[np.ndarray | None]
    expected_frames: int
    measured_fps: float | None
    pitch_degrees: float
    body_height: float | None
    clip_reasons: list[str]


def _body_height_px(points: np.ndarray, view: str) -> float:
    side = near_side(view)
    if side is None:
        heel_y = (points[SIDE_LANDMARKS["left"]["heel"], 1] + points[SIDE_LANDMARKS["right"]["heel"], 1]) / 2
    else:
        heel_y = points[SIDE_LANDMARKS[side]["heel"], 1]
    return float(heel_y - points[NOSE, 1])


def _view_ok(points: np.ndarray, visibility: np.ndarray, view: str) -> bool:
    l_sh = points[SIDE_LANDMARKS["left"]["shoulder"]]
    r_sh = points[SIDE_LANDMARKS["right"]["shoulder"]]
    if view == "anterior":
        return bool(l_sh[0] > r_sh[0])
    if view == "posterior":
        return bool(l_sh[0] < r_sh[0])
    side = near_side(view)
    other = "right" if side == "left" else "left"
    shoulder_mid_y = (l_sh[1] + r_sh[1]) / 2
    hip_mid_y = (points[SIDE_LANDMARKS["left"]["hip"], 1] + points[SIDE_LANDMARKS["right"]["hip"], 1]) / 2
    torso_height = abs(hip_mid_y - shoulder_mid_y)
    narrow = abs(l_sh[0] - r_sh[0]) < LATERAL_MAX_SHOULDER_WIDTH_RATIO * torso_height
    near_vis = float(np.mean([visibility[i] for i in SIDE_LANDMARKS[side].values()]))
    far_vis = float(np.mean([visibility[i] for i in SIDE_LANDMARKS[other].values()]))
    return bool(narrow and near_vis > far_vis)


def _frame_reasons(
    obs: FrameObservation, corrected: np.ndarray | None, view: str, width: int, height: int
) -> list[str]:
    if obs.points is None or obs.visibility is None or corrected is None:
        return ["insufficient_landmarks"]
    reasons: list[str] = []
    x_lo, x_hi = FRAME_MARGIN_FRACTION * width, (1 - FRAME_MARGIN_FRACTION) * width
    y_lo, y_hi = FRAME_MARGIN_FRACTION * height, (1 - FRAME_MARGIN_FRACTION) * height
    for idx in required_landmarks(view):
        x, y = obs.points[idx]
        if not (x_lo <= x <= x_hi and y_lo <= y <= y_hi):
            if "out_of_frame" not in reasons:
                reasons.append("out_of_frame")
        elif obs.visibility[idx] < MIN_VISIBILITY:
            if "occlusion" not in reasons:
                reasons.append("occlusion")
    if not _view_ok(corrected, obs.visibility, view):
        reasons.append("wrong_view")
    return reasons


def _measured_fps(observations: list[FrameObservation]) -> float | None:
    if len(observations) < 2:
        return None
    span = observations[-1].t - observations[0].t
    if span <= 0:
        return None
    return (len(observations) - 1) / span


def assess_clip(
    observations: list[FrameObservation],
    *,
    view: str,
    width: int,
    height: int,
    min_fps: float,
    level_tolerance_degrees: float,
) -> ClipQuality:
    if view not in FRONTAL_VIEWS + LATERAL_VIEWS:
        raise ValueError(f"unknown view {view!r}")
    center = (width / 2.0, height / 2.0)

    corrected: list[np.ndarray | None] = [
        correct_roll(o.points, o.gravity, center) if o.points is not None else None for o in observations
    ]

    frames: list[FrameQuality] = []
    usable: list[int] = []
    hold_reason_counts: Counter[str] = Counter()
    hold_positions: list[int] = []
    for pos, obs in enumerate(observations):
        if obs.t < HOLD_SKIP_SECONDS:
            frames.append(FrameQuality(obs.index, obs.t, "skipped"))
            continue
        hold_positions.append(pos)
        reasons = _frame_reasons(obs, corrected[pos], view, width, height)
        if reasons:
            frames.append(FrameQuality(obs.index, obs.t, "unusable", reasons))
            hold_reason_counts.update(reasons)
        else:
            frames.append(FrameQuality(obs.index, obs.t, "usable"))
            usable.append(pos)

    expected = len(hold_positions)
    fps = _measured_fps(observations)
    pitch_source = [observations[p] for p in hold_positions] or observations
    pitch = statistics.median(pitch_degrees(o.gravity) for o in pitch_source) if pitch_source else 90.0

    body_height = None
    if usable:
        body_height = float(np.median([_body_height_px(corrected[p], view) for p in usable]))

    reasons: list[str] = []
    if pitch > 2 * level_tolerance_degrees:
        reasons.append("camera_not_level")
    if fps is not None and fps < min_fps:
        reasons.append("insufficient_frame_rate")

    if len(usable) < max(MIN_USABLE_FRAMES, MIN_USABLE_FRACTION * expected):
        if hold_reason_counts:
            ranked = [r for r, _ in hold_reason_counts.most_common()]
            threshold = REPORT_FRAME_REASON_FRACTION * max(expected, 1)
            frame_reasons = [r for r in ranked if hold_reason_counts[r] >= threshold] or ranked[:1]
            reasons.extend(r for r in frame_reasons if r not in reasons)
        reasons.append("insufficient_frames")
    elif body_height is None or body_height <= 0:
        reasons.append("insufficient_scale")
    else:
        hips = np.array(
            [
                (corrected[p][SIDE_LANDMARKS["left"]["hip"]] + corrected[p][SIDE_LANDMARKS["right"]["hip"]]) / 2
                for p in usable
            ]
        )
        spread = float(np.sqrt(np.var(hips[:, 0]) + np.var(hips[:, 1])))
        if spread > MAX_HIP_SD_FRACTION * body_height:
            reasons.append("subject_moving")

    return ClipQuality(
        view=view,
        frames=frames,
        usable_indices=usable,
        corrected_points=corrected,
        expected_frames=expected,
        measured_fps=fps,
        pitch_degrees=pitch,
        body_height=body_height,
        clip_reasons=reasons,
    )
