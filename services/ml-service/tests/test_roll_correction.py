import math

import numpy as np
import pytest

from app.geometry.roll_correction import correct_roll, pitch_degrees, roll_angle_radians


def _rotate(points: np.ndarray, angle: float, center: tuple[float, float]) -> np.ndarray:
    c, s = math.cos(angle), math.sin(angle)
    rot = np.array([[c, -s], [s, c]])
    return (points - np.asarray(center)) @ rot.T + np.asarray(center)


def test_level_gravity_has_no_roll_and_no_pitch():
    assert roll_angle_radians((0.0, 1.0, 0.0)) == pytest.approx(0.0)
    assert pitch_degrees((0.0, 1.0, 0.0)) == pytest.approx(0.0)


def test_level_gravity_leaves_points_unchanged():
    pts = np.array([[100.0, 200.0], [300.0, 50.0]])
    out = correct_roll(pts, (0.0, 1.0, 0.0), center=(540.0, 960.0))
    np.testing.assert_allclose(out, pts)


def test_correction_makes_gravity_point_straight_down():
    # Gravity seen 10 degrees off image-down: after correction a point placed
    # along gravity from the centre must lie straight below the centre (+y).
    alpha = math.radians(10)
    g = (math.sin(alpha), math.cos(alpha), 0.0)
    center = (500.0, 500.0)
    along_gravity = np.array([[center[0] + 100 * g[0], center[1] + 100 * g[1]]])
    out = correct_roll(along_gravity, g, center=center)
    np.testing.assert_allclose(out[0], [500.0, 600.0], atol=1e-9)


def test_correction_undoes_a_camera_roll():
    # A true (gravity-aligned) scene, then the camera rolls by 5 degrees: image
    # content and the gravity direction rotate together. Correction restores
    # the original coordinates.
    center = (540.0, 960.0)
    true_pts = np.array([[690.0, 520.0], [390.0, 500.0], [540.0, 1700.0]])
    alpha = math.radians(5)
    rolled_pts = _rotate(true_pts, alpha, center)
    rolled_g = _rotate(np.array([[0.0, 1.0]]), alpha, (0.0, 0.0))[0]
    out = correct_roll(rolled_pts, (rolled_g[0], rolled_g[1], 0.0), center=center)
    np.testing.assert_allclose(out, true_pts, atol=1e-9)


def test_pitch_uses_out_of_plane_component():
    tilt = math.radians(8)
    g = (0.0, math.cos(tilt), math.sin(tilt))
    assert pitch_degrees(g) == pytest.approx(8.0)
    # Sign of the out-of-plane component does not matter (|g_z|).
    assert pitch_degrees((0.0, math.cos(tilt), -math.sin(tilt))) == pytest.approx(8.0)


def test_pitch_normalises_non_unit_gravity():
    assert pitch_degrees((0.0, 2.0, 2.0)) == pytest.approx(45.0)


def test_degenerate_gravity_is_treated_as_not_level_and_unrolled():
    # Phone lying flat: no usable image-plane component -> no roll applied,
    # pitch reported as 90 degrees so the clip fails the level check.
    assert roll_angle_radians((0.0, 0.0, 1.0)) == 0.0
    assert pitch_degrees((0.0, 0.0, 0.0)) == 90.0
