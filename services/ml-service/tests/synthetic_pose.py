"""Programmatic landmark sequences for clip-analysis tests (no video).

Poses are built in true-vertical pixel coordinates for a 1080x1920 portrait
frame, so the right answer for every metric is obvious by construction.
Person-left / person-right follow MediaPipe's labels.
"""
from __future__ import annotations

import math
from typing import Callable

import numpy as np

from app.clips.observation import NUM_LANDMARKS, FrameObservation

WIDTH = 1080
HEIGHT = 1920

INDEX = {
    "nose": 0,
    "left_ear": 7,
    "right_ear": 8,
    "left_shoulder": 11,
    "right_shoulder": 12,
    "left_hip": 23,
    "right_hip": 24,
    "left_knee": 25,
    "right_knee": 26,
    "left_ankle": 27,
    "right_ankle": 28,
    "left_heel": 29,
    "right_heel": 30,
}

# Nose-to-heel vertical distance of every base pose below.
BASE_H = 1430.0

Pose = dict[str, tuple[float, float]]


def anterior_pose(cx: float = 540.0) -> Pose:
    """Facing the camera: the person's left appears at larger image x."""
    return {
        "nose": (cx, 300.0),
        "left_ear": (cx + 45, 310.0),
        "right_ear": (cx - 45, 310.0),
        "left_shoulder": (cx + 160, 500.0),
        "right_shoulder": (cx - 160, 500.0),
        "left_hip": (cx + 100, 1000.0),
        "right_hip": (cx - 100, 1000.0),
        "left_knee": (cx + 95, 1350.0),
        "right_knee": (cx - 95, 1350.0),
        "left_ankle": (cx + 90, 1700.0),
        "right_ankle": (cx - 90, 1700.0),
        "left_heel": (cx + 90, 1730.0),
        "right_heel": (cx - 90, 1730.0),
    }


def posterior_pose(cx: float = 540.0) -> Pose:
    """Back to the camera: the person's left appears at smaller image x."""
    return {name: (2 * cx - x, y) for name, (x, y) in anterior_pose(cx).items()}


def lateral_pose(near: str = "left", facing: int = 1, cx: float = 540.0) -> Pose:
    """Side view with every near-side joint stacked on x = cx. `facing` is the
    image direction the nose points (+1 = image right). The far side sits
    10 px behind (less visible, see lateral_visibility)."""
    far = "right" if near == "left" else "left"
    pose: Pose = {"nose": (cx + 60 * facing, 300.0)}
    for part, y in (("ear", 310.0), ("shoulder", 500.0), ("hip", 1000.0), ("knee", 1350.0), ("ankle", 1700.0)):
        pose[f"{near}_{part}"] = (cx, y)
        pose[f"{far}_{part}"] = (cx - 10 * facing, y)
    pose[f"{near}_heel"] = (cx - 30 * facing, 1730.0)
    pose[f"{far}_heel"] = (cx - 40 * facing, 1730.0)
    return pose


def lateral_visibility(near: str = "left", near_vis: float = 0.95, far_vis: float = 0.3) -> np.ndarray:
    vis = np.full(NUM_LANDMARKS, 0.9)
    far = "right" if near == "left" else "left"
    for name, idx in INDEX.items():
        if name.startswith(far + "_"):
            vis[idx] = far_vis
        elif name.startswith(near + "_"):
            vis[idx] = near_vis
    return vis


def to_points(pose: Pose) -> np.ndarray:
    """(33, 2) array. Landmarks the tests do not care about sit at the body
    centre so they never affect a metric."""
    xs = [p[0] for p in pose.values()]
    ys = [p[1] for p in pose.values()]
    pts = np.tile([sum(xs) / len(xs), sum(ys) / len(ys)], (NUM_LANDMARKS, 1)).astype(float)
    for name, (x, y) in pose.items():
        pts[INDEX[name]] = (x, y)
    return pts


def rotate_pose(pose: Pose, degrees: float, center: tuple[float, float] = (WIDTH / 2, HEIGHT / 2)) -> Pose:
    """Rotates image content (x right, y down; positive turns +x toward +y)."""
    a = math.radians(degrees)
    c, s = math.cos(a), math.sin(a)
    out = {}
    for name, (x, y) in pose.items():
        dx, dy = x - center[0], y - center[1]
        out[name] = (center[0] + c * dx - s * dy, center[1] + s * dx + c * dy)
    return out


def rolled_gravity(degrees: float) -> tuple[float, float, float]:
    """Gravity as seen by a camera whose image content is rotated by `degrees`
    (same convention as rotate_pose)."""
    a = math.radians(degrees)
    return (-math.sin(a), math.cos(a), 0.0)


def make_frames(
    pose: Pose | Callable[[int], Pose],
    n: int = 60,
    fps: float = 30.0,
    gravity: tuple[float, float, float] = (0.0, 1.0, 0.0),
    visibility: np.ndarray | Callable[[int], np.ndarray] | None = None,
) -> list[FrameObservation]:
    frames = []
    for i in range(n):
        p = pose(i) if callable(pose) else pose
        if visibility is None:
            vis = np.full(NUM_LANDMARKS, 0.9)
        else:
            vis = visibility(i) if callable(visibility) else visibility
        frames.append(
            FrameObservation(
                index=i,
                t=i / fps,
                gravity=gravity,
                points=to_points(p),
                visibility=np.array(vis, dtype=float),
            )
        )
    return frames


def empty_frames(n: int = 60, fps: float = 30.0) -> list[FrameObservation]:
    """No person detected in any frame."""
    return [FrameObservation(index=i, t=i / fps, gravity=(0.0, 1.0, 0.0)) for i in range(n)]
