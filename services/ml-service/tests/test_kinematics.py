import math

import pytest

from app.geometry.kinematics import DegenerateSegmentError, angle_theta, compute_joint_angles


def test_right_angle():
    # b at origin, a along +x, c along +y -> 90 degrees
    assert angle_theta((1, 0, 0), (0, 0, 0), (0, 1, 0)) == pytest.approx(math.pi / 2)


def test_straight_line_is_pi():
    # a and c on opposite sides of b along the same line -> 180 degrees (fully extended)
    assert angle_theta((-1, 0, 0), (0, 0, 0), (1, 0, 0)) == pytest.approx(math.pi)


def test_folded_back_is_zero():
    # a and c on the same side of b -> 0 degrees (fully flexed)
    assert angle_theta((1, 0, 0), (0, 0, 0), (1, 0, 0)) == pytest.approx(0.0)


def test_degenerate_segment_raises():
    with pytest.raises(DegenerateSegmentError):
        angle_theta((0, 0, 0), (0, 0, 0), (1, 0, 0))


def _observed(x, y, z, confidence=0.9):
    return {"position": [x, y, z], "confidence": confidence, "observationState": "observed"}


def _occluded():
    return {"position": None, "confidence": 0.0, "observationState": "occluded"}


def test_compute_joint_angles_skips_when_any_source_landmark_is_occluded():
    landmarks_by_name = {
        "leftHip": _observed(0, 1, 0),
        "leftKnee": _observed(0, 0, 0),
        "leftAnkle": _occluded(),  # missing -> the whole leftKnee angle must be skipped, not fabricated
    }
    angles = compute_joint_angles(landmarks_by_name)
    assert all(a["jointName"] != "leftKnee" for a in angles)


def test_compute_joint_angles_produces_angle_when_all_three_are_observed():
    landmarks_by_name = {
        "leftHip": _observed(0, 1, 0),
        "leftKnee": _observed(0, 0, 0),
        "leftAnkle": _observed(1, 0, 0),
    }
    angles = compute_joint_angles(landmarks_by_name)
    knee = next(a for a in angles if a["jointName"] == "leftKnee")
    assert knee["thetaRadians"] == pytest.approx(math.pi / 2)
    assert knee["uncertaintyRadians"] > 0
    assert knee["sourceLandmarks"] == ["leftHip", "leftKnee", "leftAnkle"]
