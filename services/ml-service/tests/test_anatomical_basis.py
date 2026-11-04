"""app/geometry/anatomical_basis.py - the body-fixed frame, and what it buys.

The two assertions this file exists for:

- **Yaw invariance.** An angle taken in the subject's own frame must not change
  when the subject turns. A metric that drifts with stance yaw was computed in
  the camera frame, which is the defect ADR-020 was written for.
- **The 2D drift is real.** The same synthetic body, measured the 2D way, inflates
  by `1/cos(yaw)`. Asserting it documents the bug depth is fixing and fails if
  anyone silently "fixes" the 2D path without a version bump.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.geometry.anatomical_basis import (
    DOWN,
    MAX_PLANE_RMS_M,
    MIN_TORSO_POINTS,
    axial_twist_degrees,
    basis_from_landmarks,
    chord_facing_yaw,
    fit_torso_plane,
    horizontal,
    subject_yaw_to_camera,
    yaw_degrees,
)

# Half-widths in metres. Shoulder 0.19 and hip 0.14 give the ~0.19 m torso
# half-width ADR-020's 1.8-degree normal figure is based on.
SHOULDER_HALF = 0.19
HIP_HALF = 0.14
SHOULDER_Y = -1.40  # y is DOWN, so a negative y is above the floor
HIP_Y = -1.00
STAND_Z = 2.5


def torso(
    yaw_deg: float = 0.0,
    shoulder_tilt_deg: float = 0.0,
    pelvis_yaw_deg: float | None = None,
) -> dict[str, np.ndarray]:
    """Four torso landmarks in a gravity-aligned frame.

    Every parameter is expressed as the value the corresponding METRIC should
    report, so a test never has to reason about which way a sign went:

    - `yaw_deg`: the `static3d.subject_yaw_to_camera` the fit should recover.
    - `shoulder_tilt_deg`: the `shoulder_line_tilt` it should recover, under
      `static_metrics.py`'s convention - POSITIVE = person's left shoulder
      LOWER than the right.
    - `pelvis_yaw_deg`: the pelvis's own yaw; `yaw_deg - pelvis_yaw_deg` is then
      the axial twist.

    Keys are `l_sh`, `r_sh`, `l_hip`, `r_hip` using MediaPipe's person-left /
    person-right sense, which is the only source of laterality the module uses.
    """
    pelvis_yaw = yaw_deg if pelvis_yaw_deg is None else pelvis_yaw_deg

    def turn(point: np.ndarray, deg: float) -> np.ndarray:
        """Rotate about DOWN by `deg`."""
        t = np.radians(deg)
        c, s = np.cos(t), np.sin(t)
        # Rotation about the y axis (down). Sign chosen so a positive yaw turns
        # the subject's left shoulder toward the camera.
        # Signed so a POSITIVE `deg` produces a positive measured yaw, rather
        # than the reader having to trace the convention through two cross
        # products to find out.
        m = np.array([[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]])
        return m @ point

    tilt = np.radians(shoulder_tilt_deg)
    # Positive tilt puts the LEFT shoulder LOWER, matching the declared
    # convention; y is down, so its y increases.
    #
    # Offset SYMMETRICALLY, half the drop on each shoulder, so the line's total
    # rise over the full 2 * SHOULDER_HALF width is `tan(tilt)` and the built-in
    # angle really is `shoulder_tilt_deg`. Offsetting one shoulder by
    # `SHOULDER_HALF * tan(tilt)` builds HALF the intended angle -
    # `atan(tan(6)/2) = 3.0` degrees - which would have made every tolerance
    # below look like a measurement error.
    drop = SHOULDER_HALF * np.tan(tilt)
    l_sh = np.array([SHOULDER_HALF, SHOULDER_Y + drop, 0.0])
    r_sh = np.array([-SHOULDER_HALF, SHOULDER_Y - drop, 0.0])
    l_hip = np.array([HIP_HALF, HIP_Y, 0.0])
    r_hip = np.array([-HIP_HALF, HIP_Y, 0.0])

    centre = np.array([0.0, 0.0, STAND_Z])
    return {
        "l_sh": turn(l_sh, yaw_deg) + centre,
        "r_sh": turn(r_sh, yaw_deg) + centre,
        "l_hip": turn(l_hip, pelvis_yaw) + centre,
        "r_hip": turn(r_hip, pelvis_yaw) + centre,
    }


def points_of(t: dict[str, np.ndarray]) -> np.ndarray:
    return np.stack([t["l_sh"], t["r_sh"], t["l_hip"], t["r_hip"]])


def tilt_3d(t: dict[str, np.ndarray]) -> float:
    """Coronal shoulder tilt in the subject's own frame, degrees.

    Sign matches `static_metrics.py`'s declared convention for
    `static.shoulder_line_tilt`: "positive = person's left shoulder lower than
    the right". y is DOWN in this basis, so `y_left - y_right > 0` means the left
    shoulder is lower, exactly as the 2D metric's `p[left][1] - p[right][1]`
    does.
    """
    basis = basis_from_landmarks(t["l_sh"], t["r_sh"])
    assert basis is not None
    l, r = basis.project(t["l_sh"]), basis.project(t["r_sh"])
    return float(np.degrees(np.arctan2(l[1] - r[1], abs(l[0] - r[0]))))


def tilt_2d(t: dict[str, np.ndarray]) -> float:
    """The same tilt the shipped 2D path would report: image-plane x and y only,
    with depth discarded. Mirrors `static_metrics._line_tilt`."""
    l, r = t["l_sh"], t["r_sh"]
    return float(np.degrees(np.arctan2(l[1] - r[1], abs(l[0] - r[0]))))


# --- the plane fit ----------------------------------------------------------


def test_a_torso_plane_is_fitted_with_an_outward_normal():
    plane = fit_torso_plane(points_of(torso()))
    assert plane is not None
    assert plane.n_points == 4
    assert float(np.linalg.norm(plane.normal)) == pytest.approx(1.0, abs=1e-12)
    # Oriented out of the chest, toward the lens. In frame C the optical axis
    # points AWAY from the camera, so a chest-facing normal has negative z.
    assert plane.normal[2] < 0
    assert plane.rms_residual_m == pytest.approx(0.0, abs=1e-9)


def test_three_points_are_refused_because_they_fit_exactly():
    """Three points define a plane with zero residual, so a single corrupted
    depth sample is undetectable. The fourth point is what makes
    `rms_residual_m` mean anything."""
    assert MIN_TORSO_POINTS == 4
    assert fit_torso_plane(points_of(torso())[:3]) is None


def test_the_normal_sign_is_stable_across_frames():
    """SVD returns a sign-arbitrary singular vector. Without the explicit
    orientation the normal would flip between frames and the twist sign with
    it - a sign that alternates frame to frame, not a wrong constant."""
    signs = set()
    rng = np.random.default_rng(4)
    for _ in range(40):
        jittered = points_of(torso()) + rng.normal(scale=0.004, size=(4, 3))
        plane = fit_torso_plane(jittered)
        assert plane is not None
        signs.add(int(np.sign(plane.normal[2])))
    assert signs == {-1}


def test_a_collinear_point_set_is_refused():
    """An edge-on subject stacks all four landmarks near a vertical line, and
    the normal about that line is undetermined."""
    p = np.array([[0.0, -1.4, 2.5], [0.0, -1.3, 2.5], [0.0, -1.1, 2.5], [0.0, -1.0, 2.5]])
    assert fit_torso_plane(p) is None


def test_a_point_cloud_without_a_plane_is_refused():
    rng = np.random.default_rng(1)
    p = rng.normal(scale=0.3, size=(12, 3)) + np.array([0.0, -1.2, 2.5])
    plane = fit_torso_plane(p)
    assert plane is None or plane.rms_residual_m <= MAX_PLANE_RMS_M


def test_a_corrupted_depth_sample_raises_the_residual_and_is_refused():
    """The reason for the fourth point, demonstrated: one landmark pushed 25 cm
    out of plane must not produce a confident normal."""
    p = points_of(torso())
    p[0, 2] += 0.25
    assert fit_torso_plane(p) is None


def test_a_gently_curved_torso_is_still_accepted():
    """A real chest is not flat, so the residual gate must not reject anatomy."""
    p = points_of(torso())
    p[:, 2] += np.array([0.01, 0.01, -0.01, -0.01])
    assert fit_torso_plane(p) is not None


@pytest.mark.parametrize("bad", [np.nan, np.inf])
def test_a_non_finite_landmark_is_refused_not_dropped(bad):
    """A landmark whose depth could not be sampled is dropped by the CALLER. If
    one arrives as nan it is a bug, and silently ignoring it would fit a plane
    through fewer points than the caller believes."""
    p = points_of(torso())
    p[1, 2] = bad
    assert fit_torso_plane(p) is None


def test_a_wrongly_shaped_input_is_an_error():
    with pytest.raises(ValueError):
        fit_torso_plane(np.zeros((4, 2)))


# --- the basis --------------------------------------------------------------


def test_the_basis_is_right_handed_and_orthonormal():
    basis = basis_from_landmarks(torso()["l_sh"], torso()["r_sh"])
    assert basis is not None
    m = basis.matrix
    assert np.allclose(m @ m.T, np.eye(3), atol=1e-12)
    assert np.linalg.det(m) == pytest.approx(1.0, abs=1e-12)
    assert np.allclose(np.cross(basis.e_x, basis.e_y), basis.e_z, atol=1e-12)


def test_y_stays_down_so_the_2d_sign_conventions_carry_over():
    basis = basis_from_landmarks(torso()["l_sh"], torso()["r_sh"])
    assert np.allclose(basis.e_y, DOWN, atol=1e-12)


def test_laterality_comes_from_the_landmark_labels_not_the_camera():
    """`e_x` runs patient-right to patient-left. Taken from the camera, "image
    right" is the patient's left in an anterior view and their right in a
    posterior one, so the tilt sign would invert between views of one body.

    Here the subject is turned 180 degrees - facing away - and `e_x` must follow
    the body, ending up pointing the opposite way in camera coordinates while
    the measured tilt is unchanged."""
    front = torso(yaw_deg=0.0, shoulder_tilt_deg=6.0)
    back = torso(yaw_deg=180.0, shoulder_tilt_deg=6.0)
    e_front = basis_from_landmarks(front["l_sh"], front["r_sh"]).e_x
    e_back = basis_from_landmarks(back["l_sh"], back["r_sh"]).e_x
    assert np.allclose(e_front, -e_back, atol=1e-9)
    # ...and the tilt is the same body, so it reports the same number and sign.
    assert tilt_3d(back) == pytest.approx(tilt_3d(front), abs=1e-6)


def test_the_tilt_sign_matches_the_declared_2d_convention():
    """`static_metrics.py` declares "positive = person's left shoulder lower
    than the right" for `static.shoulder_line_tilt`. The 3D row must agree, or
    one patient gets two rows with opposite signs."""
    assert tilt_3d(torso(shoulder_tilt_deg=6.0)) == pytest.approx(6.0, abs=0.01)
    assert tilt_3d(torso(shoulder_tilt_deg=-6.0)) == pytest.approx(-6.0, abs=0.01)
    # Stated in words as well as signs, since this is the assertion that keeps
    # the 2D and 3D rows for one patient from disagreeing about which shoulder
    # is high: a POSITIVE reading means the person's LEFT shoulder is LOWER.
    left_lower = torso(shoulder_tilt_deg=6.0)
    assert left_lower["l_sh"][1] > left_lower["r_sh"][1]  # y is down
    assert tilt_3d(left_lower) > 0


def test_an_edge_on_subject_has_no_observable_left_right_direction():
    stacked = np.array([0.0, -1.4, 2.5]), np.array([0.0, -1.3, 2.5])
    assert basis_from_landmarks(*stacked) is None


def test_a_purely_vertical_direction_has_no_yaw_to_report():
    assert horizontal(DOWN) is None
    assert yaw_degrees(DOWN) is None


# --- yaw invariance: the point of the whole exercise ------------------------


@pytest.mark.parametrize("yaw", [-30.0, -20.0, -10.0, 0.0, 10.0, 20.0, 30.0])
def test_the_3d_coronal_tilt_does_not_drift_with_stance_yaw(yaw):
    """The subject's tilt is 6 degrees at every yaw, so the measurement must be
    6 degrees at every yaw. A number that drifts here was taken in the camera
    frame."""
    assert tilt_3d(torso(yaw_deg=yaw, shoulder_tilt_deg=6.0)) == pytest.approx(6.0, abs=0.05)


def test_the_3d_tilt_spread_across_a_yaw_sweep_is_under_one_degree():
    values = [tilt_3d(torso(yaw_deg=y, shoulder_tilt_deg=6.0)) for y in np.linspace(-30, 30, 25)]
    assert max(values) - min(values) < 1.0


def test_the_2d_tilt_inflates_by_one_over_cos_yaw():
    """The shipped defect, measured. `clip_quality._view_ok` is
    `l_sh[0] > r_sh[0]`, true for any yaw under 90 degrees, so nothing gates
    axial rotation and a genuine 6-degree tilt reads 6.93 at 30 degrees.

    This test documents the bug depth is fixing, and fails if anyone changes the
    2D path's behaviour without a `METRICS_VERSION` bump."""
    at_0 = tilt_2d(torso(yaw_deg=0.0, shoulder_tilt_deg=6.0))
    at_30 = tilt_2d(torso(yaw_deg=30.0, shoulder_tilt_deg=6.0))
    assert at_0 == pytest.approx(6.0, abs=0.01)
    assert at_30 == pytest.approx(6.0 / np.cos(np.radians(30.0)), abs=0.1)
    assert at_30 - at_0 == pytest.approx(0.93, abs=0.2)


def test_the_measured_yaw_recovers_the_stance_yaw():
    """`static3d.subject_yaw_to_camera` is the primary deliverable: it is what
    lets the 2D baseline be gated and de-biased."""
    for yaw in (-25.0, -10.0, 0.0, 10.0, 25.0):
        plane = fit_torso_plane(points_of(torso(yaw_deg=yaw)))
        assert plane is not None
        assert abs(subject_yaw_to_camera(plane)) == pytest.approx(abs(yaw), abs=1.0)


def test_a_squarely_facing_subject_reports_zero_yaw():
    plane = fit_torso_plane(points_of(torso(yaw_deg=0.0)))
    assert subject_yaw_to_camera(plane) == pytest.approx(0.0, abs=0.5)


def test_the_yaw_correction_removes_the_2d_inflation():
    """The de-bias, end to end: dividing the 2D baseline by cos(yaw) recovers
    the true tilt. Lands behind a `metrics/v2` bump because it CHANGES 2D
    values, which is why it is asserted here rather than wired in."""
    for yaw in (10.0, 20.0, 30.0):
        t = torso(yaw_deg=yaw, shoulder_tilt_deg=6.0)
        plane = fit_torso_plane(points_of(t))
        measured_yaw = subject_yaw_to_camera(plane)
        corrected = np.degrees(
            np.arctan(np.tan(np.radians(tilt_2d(t))) * np.cos(np.radians(measured_yaw)))
        )
        assert corrected == pytest.approx(6.0, abs=0.3)


# --- axial twist ------------------------------------------------------------


def test_no_twist_is_reported_when_the_pelvis_follows_the_shoulders():
    for yaw in (-30.0, 0.0, 30.0):
        t = torso(yaw_deg=yaw)
        assert axial_twist_degrees(t["l_sh"], t["r_sh"], t["l_hip"], t["r_hip"]) == pytest.approx(0.0, abs=1.0)


@pytest.mark.parametrize("twist", [-25.0, -20.0, -10.0, -5.0, 5.0, 10.0, 20.0, 25.0])
def test_a_real_twist_is_recovered_with_the_right_sign(twist):
    """Full magnitude, not an attenuated one. The plane-normal form the spec
    proposed reports 6.5 for a built 10 and 13.1 for a built 20, because the
    hips are inside the normal it compares against the hips."""
    t = torso(yaw_deg=twist, pelvis_yaw_deg=0.0)
    assert axial_twist_degrees(t["l_sh"], t["r_sh"], t["l_hip"], t["r_hip"]) == pytest.approx(
        twist, abs=0.01
    )


def test_the_plane_normal_form_would_have_attenuated_the_twist():
    """Pins the correction, so nobody reinstates the plane normal as the
    shoulder term. The error is toward ZERO, so a real trunk rotation would be
    reported as less rotated than it is."""
    t = torso(yaw_deg=10.0, pelvis_yaw_deg=0.0)
    plane = fit_torso_plane(points_of(t))
    assert plane is not None
    # The whole-torso normal splits the difference between shoulders and hips.
    from_normal = subject_yaw_to_camera(plane) - chord_facing_yaw(t["l_hip"], t["r_hip"])
    assert abs(from_normal) == pytest.approx(6.5, abs=0.3)
    # The two-chord form recovers all of it.
    assert axial_twist_degrees(t["l_sh"], t["r_sh"], t["l_hip"], t["r_hip"]) == pytest.approx(
        10.0, abs=0.01
    )


@pytest.mark.parametrize("stance", [-30.0, -15.0, 0.0, 15.0, 30.0])
def test_the_twist_is_invariant_to_how_the_subject_is_standing(stance):
    """A twist is a DIFFERENCE of two yaws, so turning the whole subject moves
    both terms equally. A twist that drifts with stance yaw has been computed in
    the camera frame - the same error as the coronal tilt, in a metric where 2D
    has no answer to compare against."""
    t = torso(yaw_deg=stance + 12.0, pelvis_yaw_deg=stance)
    assert axial_twist_degrees(t["l_sh"], t["r_sh"], t["l_hip"], t["r_hip"]) == pytest.approx(
        12.0, abs=0.01
    )


def test_the_twist_wraps_rather_than_reporting_a_reflex_angle():
    """A twist of 340 degrees is a twist of -20."""
    t = torso(yaw_deg=170.0, pelvis_yaw_deg=-170.0)
    measured = axial_twist_degrees(t["l_sh"], t["r_sh"], t["l_hip"], t["r_hip"])
    assert -180.0 < measured <= 180.0
    assert measured == pytest.approx(-20.0, abs=0.01)


def test_a_vertically_stacked_pelvis_yields_no_twist():
    t = torso()
    stacked = np.array([0.0, -1.0, 2.5]), np.array([0.0, -0.9, 2.5])
    assert axial_twist_degrees(t["l_sh"], t["r_sh"], *stacked) is None


def test_the_twist_resolution_floor_exceeds_a_five_degree_effect():
    """ADR-020 section 4: shoulder yaw carries ~2.5 degrees and pelvis yaw ~3.4,
    so the difference carries ~4.2. A 5-degree twist is NOT resolvable from a
    single frontal capture at 2.5 m, which is why the metric ships as `proxy`
    with its own uncertainty rather than as an estimate."""
    shoulder_sigma = np.degrees(np.sqrt(2) * 0.0117 / (2 * SHOULDER_HALF))
    pelvis_sigma = np.degrees(np.sqrt(2) * 0.0117 / (2 * HIP_HALF))
    twist_sigma = float(np.hypot(shoulder_sigma, pelvis_sigma))
    assert shoulder_sigma == pytest.approx(2.5, abs=0.3)
    assert pelvis_sigma == pytest.approx(3.4, abs=0.4)
    assert twist_sigma == pytest.approx(4.2, abs=0.5)
    assert twist_sigma > 4.0, "a 5-degree twist sits inside this metric's own noise"
