#!/usr/bin/env python3
"""Converts KIMORE Kinect v2 skeleton recordings into the labeled-window JSONL
format train_entry_point.py reads.

Phase labels are NOT clinician annotations - KIMORE has none. They are derived
from the smoothed velocity of a per-exercise driver angle (rising -> "ascend",
falling -> "descend", slow -> "hold"). A model trained on them learns to
reproduce that kinematic heuristic and nothing more; it carries no clinical
claim (docs/claims-and-scope.md, docs/adr/005).

Usage:
    python3 -m app.movement.kimore_converter --kimore-root /path/to/Kimore/Kimore \
        --out-dir /path/to/kimore_windows
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

from app.geometry.kinematics import JOINT_ANGLE_DEFS, DegenerateSegmentError, angle_theta
from app.movement.joint_graph import JOINT_CHANNELS

KinectFrame = list[tuple[float, float, float, int]]

KINECT_V2_JOINT_COUNT = 25
KINECT_V2_JOINT_INDEX: dict[str, int] = {
    "leftShoulder": 4, "leftElbow": 5, "leftWrist": 6,
    "rightShoulder": 8, "rightElbow": 9, "rightWrist": 10,
    "leftHip": 12, "leftKnee": 13, "leftAnkle": 14,
    "rightHip": 16, "rightKnee": 17, "rightAnkle": 18,
}
TRACKING_STATE_TRACKED = 2

# KIMORE Es1 = arm lifting, Es5 = squatting: the two exercises that overlap
# this repo's protocols. The other three (trunk tilt/rotation, pelvis
# rotation) have no descend/ascend meaning for these 8 channels.
EXERCISE_DRIVERS: dict[str, list[str]] = {
    "Es1": ["leftShoulder", "rightShoulder"],
    "Es5": ["leftKnee", "rightKnee"],
}

_ANGLE_DEFS_BY_CHANNEL = {name: (a, b, c) for name, a, b, c in JOINT_ANGLE_DEFS}


def parse_joint_position_file(path: Path) -> list[KinectFrame]:
    frames: list[KinectFrame] = []
    for line in path.read_text().splitlines():
        values = [v for v in line.strip().split(",") if v != ""]
        if len(values) != KINECT_V2_JOINT_COUNT * 4:
            continue
        try:
            numbers = [float(v) for v in values]
        except ValueError:
            continue
        frames.append(
            [
                (numbers[i], numbers[i + 1], numbers[i + 2], int(numbers[i + 3]))
                for i in range(0, len(numbers), 4)
            ]
        )
    return frames


def frame_to_angle_vector(frame: KinectFrame, min_tracking_state: int = TRACKING_STATE_TRACKED) -> list[float] | None:
    """Returns None (never a zero-filled guess) if any required joint is
    below min_tracking_state or a segment is degenerate."""
    vector: list[float] = []
    for channel in JOINT_CHANNELS:
        points = []
        for joint in _ANGLE_DEFS_BY_CHANNEL[channel]:
            x, y, z, state = frame[KINECT_V2_JOINT_INDEX[joint]]
            if state < min_tracking_state:
                return None
            points.append((x, y, z))
        try:
            vector.append(angle_theta(*points))
        except DegenerateSegmentError:
            return None
    return vector


def label_phases(
    driver: list[float | None], fps: float, hold_threshold: float, smoothing: int = 5
) -> list[str | None]:
    """hold_threshold is in rad/s on the smoothed driver."""
    n = len(driver)
    half = smoothing // 2
    smoothed: list[float | None] = []
    for i in range(n):
        span = driver[max(0, i - half) : i + half + 1]
        smoothed.append(None if any(v is None for v in span) else sum(span) / len(span))

    labels: list[str | None] = []
    for i in range(n):
        prev_i, next_i = max(0, i - 1), min(n - 1, i + 1)
        prev_v, next_v = smoothed[prev_i], smoothed[next_i]
        if smoothed[i] is None or prev_v is None or next_v is None or next_i == prev_i:
            labels.append(None)
            continue
        velocity = (next_v - prev_v) * fps / (next_i - prev_i)
        if abs(velocity) < hold_threshold:
            labels.append("hold")
        else:
            labels.append("ascend" if velocity > 0 else "descend")
    return labels


def make_windows(
    frames: list[list[float] | None],
    labels: list[str | None],
    window: int,
    stride: int,
    min_majority: float = 0.6,
) -> list[tuple[list[list[float]], str]]:
    windows = []
    for start in range(0, len(frames) - window + 1, stride):
        chunk = frames[start : start + window]
        chunk_labels = labels[start : start + window]
        if any(f is None for f in chunk) or any(l is None for l in chunk_labels):
            continue
        label, count = Counter(chunk_labels).most_common(1)[0]
        if count / window < min_majority:
            continue
        windows.append((chunk, label))
    return windows


def split_for_subject(subject_id: str, val_fraction: float = 0.15, test_fraction: float = 0.15) -> str:
    bucket = int(hashlib.sha256(subject_id.encode()).hexdigest(), 16) % 1000 / 1000
    if bucket < test_fraction:
        return "test"
    if bucket < test_fraction + val_fraction:
        return "val"
    return "train"


def _iter_recordings(kimore_root: Path):
    """Yields (subject_id, exercise, path) from <group>/<subgroup>/<id>/<EsN>/Raw/."""
    for path in sorted(kimore_root.glob("*/*/*/Es*/Raw/JointPosition*.csv")):
        exercise = path.parent.parent.name
        if exercise not in EXERCISE_DRIVERS:
            continue
        subject_dir = path.parent.parent.parent
        subject_id = "/".join(subject_dir.relative_to(kimore_root).parts)
        yield subject_id, exercise, path


def convert(
    kimore_root: Path,
    out_dir: Path,
    window: int = 30,
    stride: int = 5,
    fps: float = 30.0,
    hold_threshold: float = 0.35,
    min_tracking_state: int = TRACKING_STATE_TRACKED,
    min_majority: float = 0.6,
) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    handles = {split: (out_dir / f"{split}.jsonl").open("w") for split in ("train", "val", "test")}
    counts = {split: Counter() for split in handles}
    subjects = {split: set() for split in handles}
    recordings = 0
    total_frames = 0
    usable_frames = 0
    try:
        for subject_id, exercise, path in _iter_recordings(kimore_root):
            recordings += 1
            raw = parse_joint_position_file(path)
            angle_frames = [frame_to_angle_vector(f, min_tracking_state) for f in raw]
            total_frames += len(raw)
            usable_frames += sum(1 for f in angle_frames if f is not None)

            driver_idx = [JOINT_CHANNELS.index(c) for c in EXERCISE_DRIVERS[exercise]]
            driver = [None if f is None else sum(f[i] for i in driver_idx) / len(driver_idx) for f in angle_frames]
            labels = label_phases(driver, fps=fps, hold_threshold=hold_threshold)

            split = split_for_subject(subject_id)
            subjects[split].add(subject_id)
            for features, label in make_windows(angle_frames, labels, window, stride, min_majority):
                row = {"features": features, "label": label, "subject": subject_id, "exercise": exercise}
                handles[split].write(json.dumps(row) + "\n")
                counts[split][label] += 1
    finally:
        for handle in handles.values():
            handle.close()

    summary = {
        "source": "KIMORE (Kinect v2 skeleton), exercises " + ", ".join(sorted(EXERCISE_DRIVERS)),
        "labelSource": "heuristic-kinematic-autolabel/v0 (driver-angle velocity; not clinician-annotated)",
        "recordings": recordings,
        "totalFrames": total_frames,
        "usableFrames": usable_frames,
        "params": {
            "window": window, "stride": stride, "fps": fps, "holdThresholdRadPerS": hold_threshold,
            "minTrackingState": min_tracking_state, "minMajority": min_majority,
        },
        "splits": {
            split: {"subjects": len(subjects[split]), "windows": sum(counts[split].values()), "labels": dict(counts[split])}
            for split in handles
        },
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--kimore-root", type=Path, required=True, help="Directory containing CG/ and GPP/")
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--window", type=int, default=30)
    parser.add_argument("--stride", type=int, default=5)
    parser.add_argument("--fps", type=float, default=30.0)
    parser.add_argument("--hold-threshold", type=float, default=0.35)
    parser.add_argument("--min-tracking-state", type=int, default=TRACKING_STATE_TRACKED)
    args = parser.parse_args()
    summary = convert(
        args.kimore_root, args.out_dir, args.window, args.stride, args.fps,
        args.hold_threshold, args.min_tracking_state,
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    sys.exit(main())
