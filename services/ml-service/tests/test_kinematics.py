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
    angles = compute_joint_angles(landmarks_by_name, image_size=(1, 1))
    assert all(a["jointName"] != "leftKnee" for a in angles)


def test_compute_joint_angles_produces_angle_when_all_three_are_observed():
    landmarks_by_name = {
        "leftHip": _observed(0, 1, 0),
        "leftKnee": _observed(0, 0, 0),
        "leftAnkle": _observed(1, 0, 0),
    }
    angles = compute_joint_angles(landmarks_by_name, image_size=(1, 1))
    knee = next(a for a in angles if a["jointName"] == "leftKnee")
    assert knee["thetaRadians"] == pytest.approx(math.pi / 2)
    assert knee["uncertaintyRadians"] > 0
    assert knee["sourceLandmarks"] == ["leftHip", "leftKnee", "leftAnkle"]


def _px(x, y, size, z=0.0):
    """A landmark observed at pixel (x, y), expressed the way MediaPipe reports it (normalized to 0..1 per axis)."""
    w, h = size
    return _observed(x / w, y / h, z)


@pytest.mark.parametrize("size", [(1920, 1080), (1080, 1920), (1280, 720)])
def test_angles_are_measured_in_pixel_space_not_normalized_space(size):
    # A true right angle at the knee, drawn diagonally in pixels. In normalized
    # coordinates x and y have different scales on a non-square image, so a
    # naive angle would not be 90 degrees.
    landmarks_by_name = {
        "leftHip": _px(500, 200, size),
        "leftKnee": _px(800, 500, size),
        "leftAnkle": _px(500, 800, size),
    }
    angles = compute_joint_angles(landmarks_by_name, image_size=size)
    knee = next(a for a in angles if a["jointName"] == "leftKnee")
    assert knee["thetaRadians"] == pytest.approx(math.pi / 2, abs=1e-9)


def test_relative_depth_does_not_change_the_image_plane_angle():
    # MediaPipe image z is a relative, unscaled depth estimate; it must not leak into a 2D angle.
    size = (1920, 1080)
    flat = {"leftHip": _px(500, 200, size), "leftKnee": _px(800, 500, size), "leftAnkle": _px(500, 800, size)}
    deep = {"leftHip": _px(500, 200, size, z=-0.4), "leftKnee": _px(800, 500, size, z=0.3), "leftAnkle": _px(500, 800, size, z=-0.2)}
    a = compute_joint_angles(flat, image_size=size)[0]["thetaRadians"]
    b = compute_joint_angles(deep, image_size=size)[0]["thetaRadians"]
    assert a == pytest.approx(b, abs=1e-12)


def test_image_size_must_be_positive():
    with pytest.raises(ValueError):
        compute_joint_angles({}, image_size=(0, 1080))
