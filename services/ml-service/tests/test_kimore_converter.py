import json
import math

import pytest

from app.movement.joint_graph import JOINT_CHANNELS, NUM_CHANNELS
from app.movement.kimore_converter import (
    KINECT_V2_JOINT_INDEX,
    convert,
    frame_to_angle_vector,
    label_phases,
    make_windows,
    parse_joint_position_file,
    split_for_subject,
)

TRACKED = 2
INFERRED = 1


def _standing_frame(knee_bend: float = 0.0, state: int = TRACKED) -> list[tuple[float, float, float, int]]:
    """25-joint Kinect frame with straight arms/legs; knee_bend moves ankles
    forward so both knee angles drop below pi."""
    frame = [(0.0, 0.0, 2.0, TRACKED)] * 25
    positions = {
        "leftShoulder": (-0.2, 0.5, 2.0), "rightShoulder": (0.2, 0.5, 2.0),
        "leftElbow": (-0.2, 0.2, 2.0), "rightElbow": (0.2, 0.2, 2.0),
        "leftWrist": (-0.2, -0.1, 2.0), "rightWrist": (0.2, -0.1, 2.0),
        "leftHip": (-0.1, 0.0, 2.0), "rightHip": (0.1, 0.0, 2.0),
        "leftKnee": (-0.1, -0.4, 2.0), "rightKnee": (0.1, -0.4, 2.0),
        "leftAnkle": (-0.1, -0.8, 2.0 - knee_bend), "rightAnkle": (0.1, -0.8, 2.0 - knee_bend),
    }
    frame = list(frame)
    for name, (x, y, z) in positions.items():
        frame[KINECT_V2_JOINT_INDEX[name]] = (x, y, z, state)
    return frame


def _write_csv(path, frames):
    lines = ["", "", ""]  # KIMORE files start with blank CRLF lines
    for frame in frames:
        lines.append(",".join(f"{x},{y},{z},{s}" for x, y, z, s in frame))
    path.write_bytes("\r\n".join(lines).encode())


def test_parse_skips_blank_lines_and_crlf(tmp_path):
    csv = tmp_path / "JointPosition.csv"
    _write_csv(csv, [_standing_frame(), _standing_frame(0.2)])
    frames = parse_joint_position_file(csv)
    assert len(frames) == 2
    assert len(frames[0]) == 25
    assert frames[0][KINECT_V2_JOINT_INDEX["leftKnee"]] == (-0.1, -0.4, 2.0, TRACKED)


def test_parse_skips_malformed_rows(tmp_path):
    csv = tmp_path / "JointPosition.csv"
    csv.write_text("1,2,3\n" + ",".join(["0.1,0.2,2.0,2"] * 25) + "\n")
    assert len(parse_joint_position_file(csv)) == 1


def test_angle_vector_matches_channel_order_and_geometry():
    vector = frame_to_angle_vector(_standing_frame())
    assert vector is not None
    assert len(vector) == NUM_CHANNELS
    knee = vector[JOINT_CHANNELS.index("leftKnee")]
    elbow = vector[JOINT_CHANNELS.index("rightElbow")]
    assert knee == pytest.approx(math.pi)
    assert elbow == pytest.approx(math.pi)


def test_angle_vector_rejects_untracked_joints():
    assert frame_to_angle_vector(_standing_frame(state=INFERRED)) is None
    assert frame_to_angle_vector(_standing_frame(state=INFERRED), min_tracking_state=INFERRED) is not None


def test_label_phases_follows_driver_direction():
    fps = 30.0
    # 1 s hold, 1 s falling by 1.5 rad, 1 s hold, 1 s rising back.
    driver = [3.0] * 30 + [3.0 - 1.5 * i / 30 for i in range(30)] + [1.5] * 30 + [1.5 + 1.5 * i / 30 for i in range(30)]
    labels = label_phases(driver, fps=fps, hold_threshold=0.35, smoothing=5)
    assert labels[10] == "hold"
    assert labels[45] == "descend"
    assert labels[75] == "hold"
    assert labels[105] == "ascend"


def test_label_phases_propagates_missing_frames():
    driver = [3.0] * 10 + [None] + [3.0] * 10
    labels = label_phases(driver, fps=30.0, hold_threshold=0.35, smoothing=3)
    assert labels[10] is None
    assert labels[0] is not None and labels[20] is not None


def test_make_windows_drops_gaps_and_ambiguous_windows():
    frames = [[0.0] * NUM_CHANNELS for _ in range(20)]
    labels = ["hold"] * 10 + ["descend"] * 10
    windows = make_windows(frames, labels, window=4, stride=2, min_majority=0.75)
    assert all(label in ("hold", "descend") for _, label in windows)
    # window straddling the boundary at 8..11 is 50/50 -> dropped
    assert len(windows) == 8

    frames[5] = None
    labels[5] = None
    with_gap = make_windows(frames, labels, window=4, stride=2, min_majority=0.75)
    assert len(with_gap) < len(windows)


def test_subject_split_is_deterministic_and_covers_all_splits():
    subjects = [f"CG/Expert/E_ID{i}" for i in range(200)]
    first = [split_for_subject(s) for s in subjects]
    assert first == [split_for_subject(s) for s in subjects]
    assert set(first) == {"train", "val", "test"}


def test_convert_writes_subject_disjoint_jsonl(tmp_path):
    root = tmp_path / "Kimore" / "Kimore"
    squat = [_standing_frame(0.0)] * 30 + [_standing_frame(0.4 * i / 30) for i in range(30)] + [_standing_frame(0.4)] * 30
    for group, subgroup in [("CG", "Expert"), ("GPP", "Stroke")]:
        for sid in range(12):
            raw = root / group / subgroup / f"S_ID{sid}" / "Es5" / "Raw"
            raw.mkdir(parents=True)
            _write_csv(raw / "JointPosition011214_000000.csv", squat)
    ignored = root / "CG" / "Expert" / "S_ID0" / "Es3" / "Raw"
    ignored.mkdir(parents=True)
    _write_csv(ignored / "JointPosition011214_000001.csv", squat)

    out = tmp_path / "out"
    summary = convert(root, out, window=15, stride=5, fps=30.0, hold_threshold=0.2)

    assert summary["recordings"] == 24
    subjects_by_split = {}
    for split in ("train", "val", "test"):
        rows = [json.loads(line) for line in (out / f"{split}.jsonl").read_text().splitlines()]
        for row in rows:
            assert len(row["features"]) == 15
            assert len(row["features"][0]) == NUM_CHANNELS
            assert row["label"] in ("descend", "hold", "ascend")
            assert row["exercise"] == "Es5"
        subjects_by_split[split] = {row["subject"] for row in rows}
    assert not subjects_by_split["train"] & subjects_by_split["val"]
    assert not subjects_by_split["train"] & subjects_by_split["test"]
    assert (out / "summary.json").exists()
