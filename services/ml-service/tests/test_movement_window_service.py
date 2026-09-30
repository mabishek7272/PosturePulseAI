import pytest

from app.movement.movement_window_service import PHASE_LABELS, run_movement_window


def _synthetic_angles(seed: float) -> list[dict]:
    return [
        {"jointName": "leftKnee", "thetaRadians": seed},
        {"jointName": "rightKnee", "thetaRadians": seed + 0.1},
    ]


def test_validated_is_always_false_regardless_of_input():
    sequence = [_synthetic_angles(i * 0.1) for i in range(10)]
    result = run_movement_window(
        session_id="s1", exercise_id="e1",
        window_start_at="2026-01-01T00:00:00Z", window_end_at="2026-01-01T00:00:02Z",
        joint_angle_sequence=sequence, source_frame_ids=[f"f{i}" for i in range(10)],
    )
    assert result["validated"] is False
    assert result["predictedPhase"] in PHASE_LABELS
    assert 0.0 <= result["phaseConfidence"] <= 1.0
    assert result["repCountDelta"] == 0


def test_stgcn_architecture_also_runs():
    sequence = [_synthetic_angles(i * 0.1) for i in range(10)]
    result = run_movement_window(
        session_id="s1", exercise_id="e1",
        window_start_at="2026-01-01T00:00:00Z", window_end_at="2026-01-01T00:00:02Z",
        joint_angle_sequence=sequence, source_frame_ids=[f"f{i}" for i in range(10)],
        model_architecture="st-gcn",
    )
    assert result["validated"] is False
    assert result["modelArchitecture"] == "st-gcn"


def test_rejects_empty_window():
    with pytest.raises(ValueError):
        run_movement_window(
            session_id="s1", exercise_id="e1",
            window_start_at="2026-01-01T00:00:00Z", window_end_at="2026-01-01T00:00:02Z",
            joint_angle_sequence=[], source_frame_ids=[],
        )


def test_fault_injection_missing_joint_channels_degrades_gracefully():
    """A window where most channels are entirely absent (e.g. a badly
    occluded session) must still produce a well-shaped, honestly-labeled
    output - never crash, never fabricate a confident answer beyond the
    documented always-false validated flag."""
    sparse_sequence = [[{"jointName": "leftKnee", "thetaRadians": 1.0}] for _ in range(5)]
    result = run_movement_window(
        session_id="s1", exercise_id="e1",
        window_start_at="2026-01-01T00:00:00Z", window_end_at="2026-01-01T00:00:01Z",
        joint_angle_sequence=sparse_sequence, source_frame_ids=[f"f{i}" for i in range(5)],
    )
    assert result["validated"] is False
    assert result["predictedPhase"] in PHASE_LABELS


def test_rejects_unknown_model_architecture():
    with pytest.raises(ValueError):
        run_movement_window(
            session_id="s1", exercise_id="e1",
            window_start_at="2026-01-01T00:00:00Z", window_end_at="2026-01-01T00:00:02Z",
            joint_angle_sequence=[_synthetic_angles(0.1)], source_frame_ids=["f0"],
            model_architecture="lstm",
        )
