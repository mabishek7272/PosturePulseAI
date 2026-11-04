"""Pose observations + the depth track -> gravity-aligned torso frames.

This is the join that `depth_metrics.compute_depth_metrics` consumes and that
nothing built until now. For each usable video frame it pairs the nearest depth
frame, samples depth at the four torso landmarks, back-projects them with the
VIDEO intrinsics, and rotates them into the gravity frame.

Principles, all inherited from the pieces it joins:

- **Never infer.** Every failure drops the frame (or the landmark) and counts it.
  There is no interpolation between depth frames, no nearest-valid-pixel search,
  and no borrowing a neighbour frame's sample. A depth frame more than
  `MAX_PAIRING_GAP_S` from the video frame is not paired at all.
- **Every drop is counted by reason**, in `DepthJoinStats`, so "why did we get no
  depth metric" has an answer other than a bare unsupported flag.
- **The video intrinsics unproject; the depth intrinsics only locate the
  patch.** See `backprojection.py` on why.
"""
from __future__ import annotations

import bisect
from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from app.clips.depth_track import DepthFrame
from app.clips.observation import FrameObservation, LEFT_HIP, LEFT_SHOULDER, RIGHT_HIP, RIGHT_SHOULDER
from app.geometry.backprojection import (
    MAX_BODY_DEPTH_DEVIATION_M,
    TORSO_PATCH_RADIUS_M,
    backproject,
    sample_landmark_depth,
)
from app.geometry.gravity_alignment import rotation_to_gravity_frame
from app.geometry.intrinsics import CameraIntrinsics
from app.metrics.depth_metrics import REQUIRED_LANDMARKS, FrameTorso

#: Largest gap between a video frame and the depth frame it is paired with.
#:
#: Depth runs at ~15 Hz (a 67 ms period) against video at 30-60 Hz, so the
#: nearest depth frame is normally within half a period, ~33 ms. 100 ms allows
#: one dropped depth frame and no more. A subject holding still barely moves in
#: 100 ms, but this is a MEASUREMENT of position, and pairing across a longer gap
#: would be attributing a depth taken at one moment to a pose seen at another.
MAX_PAIRING_GAP_S = 0.1

#: Body-landmark index for each name `depth_metrics` uses. Person-left /
#: person-right, MediaPipe's own labels - the only source of laterality.
LANDMARK_INDEX = {
    "l_sh": LEFT_SHOULDER,
    "r_sh": RIGHT_SHOULDER,
    "l_hip": LEFT_HIP,
    "r_hip": RIGHT_HIP,
}

#: Why a frame, or a landmark in it, was dropped. Stable strings: they are
#: reported, and tests assert on them.
NO_POSE = "no_pose"
NO_DEPTH_FRAME = "no_depth_frame_within_gap"
BAD_GRAVITY = "unusable_gravity"
LANDMARK_REJECTED = "landmark_depth_rejected"
OFF_BODY = "landmark_off_body_depth"


@dataclass
class DepthJoinStats:
    """What the join kept and what it dropped, by reason."""

    frames_considered: int = 0
    frames_kept: int = 0
    dropped: Counter = field(default_factory=Counter)
    #: Landmark-level rejections, keyed by landmark name, for finding which one
    #: is the weak link (a dark garment over one hip, say).
    landmark_rejections: Counter = field(default_factory=Counter)


def _nearest(times: list[float], t: float) -> int | None:
    """Index of the time closest to `t` in a sorted list, or None if empty."""
    if not times:
        return None
    i = bisect.bisect_left(times, t)
    candidates = [j for j in (i - 1, i) if 0 <= j < len(times)]
    return min(candidates, key=lambda j: abs(times[j] - t))


def build_torso_frames(
    observations: list[FrameObservation],
    usable_indices: list[int],
    depth_frames: list[DepthFrame],
    intrinsics: CameraIntrinsics,
) -> tuple[list[FrameTorso], DepthJoinStats]:
    """The gravity-aligned torso frames for `usable_indices`, with drop counts.

    `usable_indices` are positions into `observations` that `clip_quality`
    already accepted, so the hold-window and visibility logic is not redone here.
    Landmark pixels are read from `observation.points`, which are pixels of the
    ORIENTED image BEFORE roll correction - the frame `intrinsics` is expressed
    in. The roll-corrected points would be in a rotated frame the intrinsics do
    not describe.
    """
    stats = DepthJoinStats()
    if not depth_frames:
        return [], stats

    depth_times = [f.t for f in depth_frames]
    height, width = depth_frames[0].depth_m.shape
    k_depth = intrinsics.rescaled_to(width, height)

    out: list[FrameTorso] = []
    for position in usable_indices:
        stats.frames_considered += 1
        obs = observations[position]

        if obs.points is None:
            stats.dropped[NO_POSE] += 1
            continue

        j = _nearest(depth_times, obs.t)
        if j is None or abs(depth_times[j] - obs.t) > MAX_PAIRING_GAP_S:
            stats.dropped[NO_DEPTH_FRAME] += 1
            continue
        depth = depth_frames[j]

        r_gravity = rotation_to_gravity_frame(obs.gravity)
        if r_gravity is None:
            stats.dropped[BAD_GRAVITY] += 1
            continue

        samples = {}
        for name, index in LANDMARK_INDEX.items():
            u, v = float(obs.points[index][0]), float(obs.points[index][1])
            sample = sample_landmark_depth(
                depth.depth_m,
                u=u,
                v=v,
                k_video=intrinsics,
                k_depth=k_depth,
                radius_m=TORSO_PATCH_RADIUS_M,
                confidence=depth.confidence,
            )
            if sample is None:
                stats.landmark_rejections[name] += 1
                continue
            samples[name] = (u, v, sample)

        if len(samples) < len(REQUIRED_LANDMARKS):
            # All four are needed for a torso plane; a frame missing one cannot be
            # completed from a neighbour, so it is dropped.
            stats.dropped[LANDMARK_REJECTED] += 1
            continue

        # Second pass: the body-depth plausibility gate, now that there is a body
        # depth to compare against. The sampler cannot apply it on the first
        # landmark of a frame because there is nothing yet to compare to.
        body_depth = float(np.median([s.depth_m for _, _, s in samples.values()]))
        if any(abs(s.depth_m - body_depth) > MAX_BODY_DEPTH_DEVIATION_M for _, _, s in samples.values()):
            stats.dropped[OFF_BODY] += 1
            continue

        names = list(REQUIRED_LANDMARKS)
        cam = np.stack([backproject(samples[n][0], samples[n][1], samples[n][2].depth_m, intrinsics) for n in names])
        grav = cam @ r_gravity.T

        out.append(
            FrameTorso(
                index=position,
                points={n: grav[i] for i, n in enumerate(names)},
                uv={n: (samples[n][0], samples[n][1]) for n in names},
                depth_sigma={n: samples[n][2].sigma_m for n in names},
                rotation=r_gravity,
                depth_m={n: samples[n][2].depth_m for n in names},
            )
        )
        stats.frames_kept += 1

    return out, stats
