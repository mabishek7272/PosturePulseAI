"""app/geometry/gravity_alignment.py - the rotation into the gravity frame.

Every test here exists because the two ways of getting `R_g` wrong - flipping the
target to `[0, -1, 0]`, or negating the Rodrigues axis - are both **invisible in
magnitudes**. A rotation preserves vector length, so every recovered angle still
has a plausible value and only its sign or size is wrong. So nothing below
asserts that an angle "looks reasonable": the tests pin the rotation against
gravity itself to 1e-12, and pin orientation against an *anatomical* relation
(the nose is above the heel) rather than a vector equality, which catches a wrong
target reached by any route.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.geometry.gravity_alignment import (
    TARGET,
    residual_pitch_degrees,
    rotation_to_gravity_frame,
    skew,
    to_gravity_frame,
)


def camera_from_world(pitch_deg: float, roll_deg: float = 0.0) -> np.ndarray:
    """Rotation taking WORLD coordinates into the camera frame C.

    World and camera frame C share the convention x = right, **y = down**,
    z = away; the camera is pitched down about x, then rolled about z.
    """
    p, r = np.radians(pitch_deg), np.radians(roll_deg)
    rx = np.array([[1, 0, 0], [0, np.cos(p), -np.sin(p)], [0, np.sin(p), np.cos(p)]])
    rz = np.array([[np.cos(r), -np.sin(r), 0], [np.sin(r), np.cos(r), 0], [0, 0, 1]])
    return rz @ rx


def pitched(deg: float, roll_deg: float = 0.0) -> np.ndarray:
    """Gravity as frame C reports it for a camera tilted by `deg` / `roll_deg`.

    DERIVED from `camera_from_world` rather than written out as a formula.
    Writing it independently is how this fixture was wrong first time round: the
    roll term had the opposite sign to the rotation the body fixture used, so
    the tests failed against correct code. A fixture that states the convention
    twice can disagree with itself; this one cannot.
    """
    g = camera_from_world(deg, roll_deg) @ np.array([0.0, 1.0, 0.0])
    return g / np.linalg.norm(g)


# --- the rotation itself ----------------------------------------------------


def test_a_level_camera_needs_no_rotation():
    r = rotation_to_gravity_frame([0.0, 1.0, 0.0])
    assert np.allclose(r, np.eye(3), atol=1e-12)


@pytest.mark.parametrize("deg", [0.5, 5.0, 10.0, 20.0, 35.0, 70.0, 100.0, 170.0])
@pytest.mark.parametrize("roll", [0.0, 7.0, -30.0])
def test_the_rotation_puts_gravity_exactly_on_the_target(deg, roll):
    """The one assertion that catches a negated axis. With `v = [g_z, 0, -g_x]`
    instead of `g x target`, R is the transpose of the intended rotation and
    gravity comes out at TWICE the input pitch - 10 degrees becomes 20, 20
    becomes 40 - while every vector length is untouched."""
    g = pitched(deg, roll)
    r = rotation_to_gravity_frame(g)
    assert r is not None
    assert np.allclose(r @ g, TARGET, atol=1e-12)
    assert residual_pitch_degrees(r, g) == pytest.approx(0.0, abs=1e-6)


def test_the_negated_axis_doubles_the_tilt_rather_than_removing_it():
    """Pins the failure mode, in the units it appears in. If someone
    "simplifies" the axis back to `[g_z, 0, -g_x]`, the test above fails and
    this one explains why."""
    for deg in (10.0, 20.0, 30.0):
        g = pitched(deg)
        c = float(g @ TARGET)
        wrong_axis = np.array([g[2], 0.0, -g[0]])  # = -(g x target)
        k = skew(wrong_axis)
        r_wrong = np.eye(3) + k + k @ k * (1.0 / (1.0 + c))

        assert residual_pitch_degrees(r_wrong, g) == pytest.approx(2 * deg, abs=1e-6)
        # ...and it is still a perfectly well-formed rotation, which is the
        # whole problem: it is the transpose of the right answer.
        r_right = rotation_to_gravity_frame(g)
        assert np.allclose(r_wrong, r_right.T, atol=1e-12)
        assert np.allclose(r_wrong @ r_wrong.T, np.eye(3), atol=1e-12)


@pytest.mark.parametrize("deg", [0.0, 3.0, 17.0, 90.0, 150.0, 179.0])
@pytest.mark.parametrize("roll", [0.0, 45.0, -80.0])
def test_the_result_is_always_a_proper_rotation(deg, roll):
    """Orthonormal with determinant +1. A determinant of -1 would be a
    reflection, which mirrors left and right - a silent laterality swap."""
    r = rotation_to_gravity_frame(pitched(deg, roll))
    assert r is not None
    assert np.allclose(r @ r.T, np.eye(3), atol=1e-12)
    assert np.linalg.det(r) == pytest.approx(1.0, abs=1e-12)


def test_an_upside_down_camera_is_handled_rather_than_dividing_by_zero():
    """`1/(1 + c)` is a division by zero at exactly antiparallel. This is not a
    theoretical case: an iPad handed over or set face-down reads this way for a
    frame or two."""
    g = np.array([0.0, -1.0, 0.0])
    r = rotation_to_gravity_frame(g)
    assert r is not None
    assert np.all(np.isfinite(r))
    assert np.allclose(r @ g, TARGET, atol=1e-12)
    assert np.linalg.det(r) == pytest.approx(1.0, abs=1e-12)


@pytest.mark.parametrize("eps", [1e-16, 1e-14, 1e-12, 1e-10, 1e-8, 1e-7, 1e-6, 1e-5, 1e-3])
def test_near_antiparallel_keeps_full_precision(eps):
    """The neighbourhood of the singularity, at machine precision.

    This is the test the compact `1/(1 + c)` form cannot pass. With it, the
    error is 1.8e-4 at eps=1e-6 and 4.7e-2 at eps=1e-7, and below ~1e-8 the
    denominator underflows to zero and the result is `nan`. The explicit-angle
    form holds ~2e-16 throughout, so the tolerance here can be absolute rather
    than scaled to how close the input sits to inverted."""
    g = np.array([eps, -1.0, 0.0])
    g = g / np.linalg.norm(g)
    r = rotation_to_gravity_frame(g)
    assert r is not None
    assert np.all(np.isfinite(r))
    assert np.allclose(r @ g, TARGET, atol=1e-12)
    assert np.linalg.det(r) == pytest.approx(1.0, abs=1e-12)


@pytest.mark.parametrize("bad", [[0.0, 0.0, 0.0], [np.nan, 1.0, 0.0], [np.inf, 0.0, 0.0], [1.0, 0.0]])
def test_an_unusable_gravity_reading_returns_none(bad):
    """None, never an approximate rotation. A substituted identity would report
    an un-levelled measurement as a levelled one."""
    assert rotation_to_gravity_frame(bad) is None


def test_gravity_need_not_arrive_normalised():
    r = rotation_to_gravity_frame([0.0, 9.81, 0.0])
    assert np.allclose(r, np.eye(3), atol=1e-12)


# --- orientation, asserted anatomically -------------------------------------


def _standing_body(pitch_deg: float, roll_deg: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    """A nose and a heel, 1.6 m apart vertically, seen by a tilted camera.

    Built in the WORLD (y down, so the nose has the smaller y), then rotated
    into the camera frame by the inverse of the camera's own tilt - so the
    fixture never uses the function under test to make its own input.
    """
    nose_world = np.array([0.0, -1.60, 2.5])
    heel_world = np.array([0.0, 0.0, 2.5])
    m = camera_from_world(pitch_deg, roll_deg)
    return m @ nose_world, m @ heel_world


@pytest.mark.parametrize("pitch", [0.0, 10.0, 20.0, -15.0])
@pytest.mark.parametrize("roll", [0.0, 12.0, -25.0])
def test_the_nose_ends_up_above_the_heel(pitch, roll):
    """The anatomical assertion. In the gravity frame y is DOWN, so "above"
    means a SMALLER y. Asserting this rather than a vector equality catches a
    flipped target reached by any route - including a sign error somewhere else
    that happens to produce `[0, -1, 0]`."""
    nose_cam, heel_cam = _standing_body(pitch, roll)
    g = pitched(pitch, roll)
    out = to_gravity_frame(np.stack([nose_cam, heel_cam]), g)
    assert out is not None
    nose, heel = out
    assert nose[1] < heel[1], "nose must be above the heel (y is down)"
    # And the body must come back vertical, which is what removing pitch buys.
    assert abs(nose[0] - heel[0]) < 1e-6
    assert abs(nose[2] - heel[2]) < 1e-6
    assert heel[1] - nose[1] == pytest.approx(1.60, abs=1e-6)


@pytest.mark.parametrize("pitch", [10.0, 20.0])
def test_the_flipped_target_inverts_the_body(pitch):
    """With `[0, -1, 0]` as the target the nose lands BELOW the heel, and every
    coronal and sagittal sign flips with it - while every distance is
    unchanged, which is why no magnitude check would notice."""
    nose_cam, heel_cam = _standing_body(pitch)
    g = pitched(pitch)
    wrong_target = np.array([0.0, -1.0, 0.0])
    v = np.cross(g, wrong_target)
    c = float(g @ wrong_target)
    k = skew(v)
    r_wrong = np.eye(3) + k + k @ k * (1.0 / (1.0 + c))

    nose, heel = (np.stack([nose_cam, heel_cam]) @ r_wrong.T)
    assert nose[1] > heel[1], "the flipped target must invert the body"
    # Same length, opposite sense: the error is purely in sign.
    assert abs(heel[1] - nose[1]) == pytest.approx(1.60, abs=1e-6)


def test_pitch_and_roll_are_both_removed_at_once():
    """`roll_correction.py` can only undo roll and says so: pitch "cannot be
    undone from a single 2D image, so it is only measured and used to reject the
    clip". This is the concrete benefit of the depth path."""
    nose_cam, heel_cam = _standing_body(18.0, 9.0)
    g = pitched(18.0, 9.0)
    r = rotation_to_gravity_frame(g)
    assert residual_pitch_degrees(r, g) == pytest.approx(0.0, abs=1e-9)
    nose, heel = (np.stack([nose_cam, heel_cam]) @ r.T)
    # Perfectly vertical in both image axes, not just one.
    assert np.hypot(nose[0] - heel[0], nose[2] - heel[2]) < 1e-6


def test_rotation_does_not_change_distances():
    """States the property that makes the sign errors above so dangerous, so
    that the reason for the anatomical assertions is recorded in the suite."""
    rng = np.random.default_rng(7)
    pts = rng.normal(size=(20, 3))
    r = rotation_to_gravity_frame(pitched(23.0, -11.0))
    out = pts @ r.T
    assert np.allclose(np.linalg.norm(pts, axis=1), np.linalg.norm(out, axis=1), atol=1e-12)


def test_unusable_gravity_propagates_as_none_through_the_point_transform():
    assert to_gravity_frame(np.zeros((3, 3)), [0.0, 0.0, 0.0]) is None


def test_a_wrongly_shaped_point_array_is_an_error_not_a_guess():
    with pytest.raises(ValueError):
        to_gravity_frame(np.zeros((3, 2)), [0.0, 1.0, 0.0])
