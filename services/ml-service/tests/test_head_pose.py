"""app/geometry/head_pose.py - rigid head pose, and the ear-line fallback.

Two things this file is for: proving the solver recovers a known pose exactly,
and recording the uncertainty it actually achieves rather than the one hoped
for. The second matters more, because the module's whole justification is being
better than the 14.6-degree ear line - and by how much is the question a
clinician's expectation rests on.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.geometry.head_pose import (
    CANONICAL_LANDMARKS_MM,
    EAR_LINE_SIGMA_DEGREES,
    MIN_POINTS,
    RIGID_FIT_VIEWS,
    RIGID_SIX,
    head_pose_from_landmarks,
    head_roll_from_ears,
    project,
    rodrigues,
    solve_rigid_pose,
)
from app.geometry.intrinsics import CameraIntrinsics

K = CameraIntrinsics(fx=1000.0, fy=1000.0, cx=539.5, cy=719.5, width=1080, height=1440)
LEVEL_GRAVITY = (0.0, 1.0, 0.0)
POINTS = np.array([CANONICAL_LANDMARKS_MM[n] for n in RIGID_SIX])


def rotation_vector(r: np.ndarray) -> np.ndarray:
    """Inverse Rodrigues, so the fixture never calls the function under test."""
    theta = float(np.arccos(np.clip((np.trace(r) - 1) / 2, -1.0, 1.0)))
    if theta < 1e-9:
        return np.zeros(3)
    axis = np.array([r[2, 1] - r[1, 2], r[0, 2] - r[2, 0], r[1, 0] - r[0, 1]])
    return axis / (2 * np.sin(theta)) * theta


def head(roll=0.0, pitch=0.0, yaw=0.0, *, z=2.5, noise=0.0, seed=0) -> dict[str, tuple[float, float]]:
    """Project the canonical head at a known Z-X-Y orientation."""
    rr, rp, ry = np.radians([roll, pitch, yaw])
    rz = np.array([[np.cos(rr), -np.sin(rr), 0], [np.sin(rr), np.cos(rr), 0], [0, 0, 1]])
    rx = np.array([[1, 0, 0], [0, np.cos(rp), -np.sin(rp)], [0, np.sin(rp), np.cos(rp)]])
    ry_m = np.array([[np.cos(ry), 0, np.sin(ry)], [0, 1, 0], [-np.sin(ry), 0, np.cos(ry)]])
    uv = project(POINTS, rotation_vector(rz @ rx @ ry_m), np.array([0.0, 0.0, z]), K)
    if noise:
        uv = uv + np.random.default_rng(seed).normal(scale=noise, size=uv.shape)
    return {name: (float(uv[i, 0]), float(uv[i, 1])) for i, name in enumerate(RIGID_SIX)}


# --- the solver --------------------------------------------------------------


@pytest.mark.parametrize(
    "roll,pitch,yaw",
    [(0, 0, 0), (8, 0, 0), (-8, 0, 0), (0, 10, 0), (0, -10, 0), (0, 0, 12), (5, -6, 8), (-7, 9, -11)],
)
def test_a_known_pose_is_recovered_exactly(roll, pitch, yaw):
    """Including COMBINED rotations, which is where the first version failed.

    Reading roll off the rotated left axis and pitch off the rotated down axis
    independently looks equivalent to a proper decomposition and is not, because
    the three rotations do not commute: (5, -6, 8) came back as (4.16, +6.02,
    7.50) - pitch sign inverted, roll a degree out - while the pose itself was
    recovered to 5e-14 px. An angle convention is a decomposition, not a
    property of the rotation.
    """
    pose = head_pose_from_landmarks(head(roll, pitch, yaw), LEVEL_GRAVITY, K)
    assert pose is not None
    assert pose.roll_degrees == pytest.approx(roll, abs=0.01)
    assert pose.pitch_degrees == pytest.approx(pitch, abs=0.01)
    assert pose.yaw_degrees == pytest.approx(yaw, abs=0.01)
    assert pose.rms_reprojection_px < 1e-6


def test_the_fit_reports_its_own_evidence():
    pose = head_pose_from_landmarks(head(6, -4, 5), LEVEL_GRAVITY, K)
    assert pose.n_points == len(RIGID_SIX)
    assert pose.rms_reprojection_px >= 0.0
    assert 0 < pose.iterations <= 60
    assert pose.method == "rigid_fit"


def test_noise_shows_up_as_reprojection_error():
    """A fit that cannot explain the landmarks must say so, so a caller can
    reject a bad frame rather than take its pose."""
    clean = head_pose_from_landmarks(head(6), LEVEL_GRAVITY, K)
    noisy = head_pose_from_landmarks(head(6, noise=3.0, seed=1), LEVEL_GRAVITY, K)
    assert noisy.rms_reprojection_px > clean.rms_reprojection_px
    assert noisy.rms_reprojection_px > 1.0


def test_the_pose_is_recovered_at_other_distances():
    for z in (1.7, 2.5, 3.0):
        pose = head_pose_from_landmarks(head(7, -3, 4, z=z), LEVEL_GRAVITY, K)
        assert pose.roll_degrees == pytest.approx(7, abs=0.05)
        assert pose.translation[2] == pytest.approx(z, rel=0.02)


def test_a_camera_tilt_is_removed_by_the_gravity_frame():
    """The head's orientation is reported against GRAVITY, not the camera, so a
    tilted iPad does not become a tilted head."""
    # A camera rolled so that a level head APPEARS rolled by +10 degrees reads
    # gravity leaning the other way - the x component is negative. Determined
    # empirically rather than reasoned: with the sign the other way round the
    # reported roll is 20 degrees, which is the tilt being added to the head
    # instead of removed from it, and nothing about a 20-degree head tilt looks
    # impossible in an output.
    tilted_gravity = (-float(np.sin(np.radians(10.0))), float(np.cos(np.radians(10.0))), 0.0)
    rolled_view = head(10.0)  # what that camera would see of a level head
    pose = head_pose_from_landmarks(rolled_view, tilted_gravity, K)
    assert pose is not None
    assert pose.roll_degrees == pytest.approx(0.0, abs=0.5)


# --- the measured uncertainty ------------------------------------------------


def sigma_at(noise_px: float, trials: int = 200) -> dict[str, float]:
    rolls, pitches, yaws = [], [], []
    for seed in range(trials):
        pose = head_pose_from_landmarks(head(6, -4, 5, noise=noise_px, seed=seed), LEVEL_GRAVITY, K)
        if pose is None:
            continue
        rolls.append(pose.roll_degrees)
        pitches.append(pose.pitch_degrees)
        yaws.append(pose.yaw_degrees)
    return {
        "roll": float(np.std(rolls)),
        "pitch": float(np.std(pitches)),
        "yaw": float(np.std(yaws)),
        "roll_bias": float(np.mean(rolls) - 6.0),
    }


def test_roll_meets_the_one_and_a_half_degree_target():
    """The headline claim, measured. At ~1.3 px of landmark error - what a face
    model should manage on a 92 px head - roll comes out near 1.55 degrees."""
    assert sigma_at(1.3)["roll"] == pytest.approx(1.55, abs=0.35)


def test_pitch_and_yaw_do_NOT_meet_it_and_that_is_geometric():
    """About 1.6x worse than roll, consistently.

    Roll is fixed by the widest in-plane baseline the template has (tragus to
    tragus, 140 mm). Pitch and yaw depend on DEPTH differences inside the
    template - the tragi sit about 75 mm behind the nasion - which at 2.5 m
    project into only a few pixels. A monocular fit cannot do better, so this
    module's roll is a usable measurement while its pitch and yaw are coarse."""
    s = sigma_at(1.3)
    assert s["pitch"] > 1.5 * s["roll"]
    assert s["yaw"] > 1.5 * s["roll"]
    assert s["pitch"] == pytest.approx(2.43, abs=0.6)


def test_the_uncertainty_scales_with_landmark_error():
    one, two = sigma_at(1.0), sigma_at(2.0)
    assert two["roll"] / one["roll"] == pytest.approx(2.0, rel=0.2)
    assert one["roll"] == pytest.approx(1.19, abs=0.3)


def test_the_fit_is_unbiased_so_averaging_frames_does_help_here():
    """Unlike the static landmark offsets elsewhere in this pipeline, zero-mean
    landmark noise through this solver produces a zero-mean pose error - so
    frame averaging genuinely reduces it. The MORPHOLOGY offset does not average
    away, which is the separate point the module docstring makes."""
    assert abs(sigma_at(1.3)["roll_bias"]) < 0.3


def test_it_is_a_large_improvement_on_the_ear_line_it_replaces():
    """The justification for the module existing at all: roughly tenfold."""
    assert EAR_LINE_SIGMA_DEGREES / sigma_at(1.3)["roll"] > 10.0


# --- refusals ----------------------------------------------------------------


@pytest.mark.parametrize("view", ["posterior", "left_lateral", "right_lateral"])
def test_a_non_anterior_view_returns_none_rather_than_a_degraded_fit(view):
    """There is no face in a posterior capture. `head_roll_from_ears` is the
    documented path there, not a worse version of this one."""
    assert head_pose_from_landmarks(head(6), LEVEL_GRAVITY, K, view=view) is None
    assert view not in RIGID_FIT_VIEWS


def test_too_few_landmarks_returns_none():
    """Four points is the minimum for a unique perspective pose. Returning the
    least-squares answer for three would report an orientation the image does
    not contain."""
    full = head(6)
    too_few = {name: full[name] for name in list(full)[: MIN_POINTS - 1]}
    assert solve_rigid_pose(too_few, K) is None


def test_exactly_the_minimum_number_of_points_still_fits():
    full = head(6)
    minimal = {name: full[name] for name in list(full)[:MIN_POINTS]}
    assert solve_rigid_pose(minimal, K) is not None


def test_an_unusable_gravity_reading_returns_none():
    """A head orientation reported against a gravity vector that does not exist
    would be an orientation against nothing."""
    assert head_pose_from_landmarks(head(6), (0.0, 0.0, 0.0), K) is None


def test_a_non_finite_landmark_returns_none():
    broken = dict(head(6))
    broken["nasion"] = (float("nan"), 100.0)
    assert solve_rigid_pose(broken, K) is None


def test_unknown_landmark_names_are_ignored_not_guessed():
    mixed = dict(head(6))
    mixed["left_eyebrow_outer"] = (500.0, 600.0)
    pose = head_pose_from_landmarks(mixed, LEVEL_GRAVITY, K)
    assert pose is not None
    assert pose.n_points == len(RIGID_SIX)


def test_a_point_behind_the_camera_is_refused():
    with pytest.raises(ValueError, match="behind the camera"):
        project(POINTS, np.zeros(3), np.array([0.0, 0.0, -1.0]), K)


# --- the canonical template --------------------------------------------------


def test_every_canonical_landmark_is_on_bone_or_bound_to_it():
    """Rigidity is the selection criterion, not how easily a landmarker finds a
    point. Lips, cheeks, brows and jaw move with expression and swallowing,
    which would appear as head rotation."""
    assert set(RIGID_SIX) <= set(CANONICAL_LANDMARKS_MM)
    soft = {"lip", "cheek", "brow", "chin", "jaw", "eyelid", "nostril"}
    for name in CANONICAL_LANDMARKS_MM:
        assert not any(token in name for token in soft), name


def test_the_template_is_left_right_symmetric():
    """An asymmetric template would put a constant roll into every pose."""
    for left in [n for n in CANONICAL_LANDMARKS_MM if n.endswith("_left")]:
        right = left.replace("_left", "_right")
        lx, ly, lz = CANONICAL_LANDMARKS_MM[left]
        rx, ry, rz = CANONICAL_LANDMARKS_MM[right]
        assert lx == pytest.approx(-rx) and ly == pytest.approx(ry) and lz == pytest.approx(rz)


def test_a_symmetric_template_yields_zero_roll_for_a_level_head():
    pose = head_pose_from_landmarks(head(0, 0, 0), LEVEL_GRAVITY, K)
    assert pose.roll_degrees == pytest.approx(0.0, abs=0.01)


def test_rodrigues_round_trips():
    for vec in ([0.0, 0.0, 0.0], [0.1, -0.2, 0.3], [1.5, 0.0, 0.0]):
        r = rodrigues(np.array(vec))
        assert np.allclose(r @ r.T, np.eye(3), atol=1e-12)
        assert np.linalg.det(r) == pytest.approx(1.0, abs=1e-12)


# --- the fallback ------------------------------------------------------------


def test_the_ear_line_still_works_and_declares_its_own_uncertainty():
    """Retained deliberately. Removing it would leave the posterior view with no
    head measurement at all, and its sigma is carried so a result from it can
    never be pooled with a rigid-fit one."""
    result = head_roll_from_ears((600.0, 410.0), (480.0, 400.0))
    assert result is not None
    assert result.method == "ear_line"
    assert result.sigma_degrees == EAR_LINE_SIGMA_DEGREES
    # Left ear lower (larger y, y is down) = positive, same as the rigid fit.
    assert result.roll_degrees > 0


def test_the_fallback_sign_matches_the_rigid_fit_and_the_2d_metric():
    """Three paths measure head tilt - the 2D metric, the rigid fit and this -
    and all three must agree about which way a head is tilted, or one patient
    gets contradictory rows."""
    left_lower = head_roll_from_ears((600.0, 420.0), (480.0, 400.0))
    left_higher = head_roll_from_ears((600.0, 380.0), (480.0, 400.0))
    assert left_lower.roll_degrees > 0 > left_higher.roll_degrees


def test_the_fallback_uncertainty_is_the_arithmetic_not_a_guess():
    """sqrt(2) * 0.0358 m / 0.140 m, in degrees."""
    expected = np.degrees(np.sqrt(2) * (0.01 * 1430.0 * 2.5 / 1000.0) / 0.140)
    assert EAR_LINE_SIGMA_DEGREES == pytest.approx(expected, abs=0.5)
    # The sqrt(2) is two independent landmark errors at the ends of ONE chord.
    # There is no sqrt(n) averaging to divide by - doing so gave 14.6 and
    # cancelled the very term it was meant to account for.
    assert EAR_LINE_SIGMA_DEGREES > 20.0


def test_coincident_or_non_finite_ears_return_none():
    assert head_roll_from_ears((500.0, 400.0), (500.0, 400.0)) is None
    assert head_roll_from_ears((float("nan"), 400.0), (480.0, 400.0)) is None
