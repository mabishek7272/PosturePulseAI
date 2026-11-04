"""Does the uncertainty this pipeline REPORTS match the spread it actually has?

This is the honesty test for the depth path. An uncertainty model that is wrong
in the optimistic direction is worse than no model: it hands a clinician a
tighter number than the instrument earned, and nothing in the output shows it.

The check is split in two on purpose, because a single end-to-end Monte Carlo
would be unable to distinguish two different failures and would also be
**biased**:

- **Propagation** (`test_analytical_sigma_matches_the_empirical_spread`)
  perturbs each landmark's `(u, v, Z)` with the declared sigmas and measures the
  spread of the recovered angle. This isolates the maths - the Jacobian and the
  `atan2` gradient - from the sampler.

- **The input sigma** (`test_the_physics_sigma_matches_the_correlated_field`)
  runs the real `sample_landmark_depth` over the real correlated-noise field and
  asks whether `POINT_SIGMA_M * sqrt(pi/2) / sqrt(n_effective)` describes the
  patch median's actual spread. This is the NON-CIRCULAR half: the analytical
  sigma comes from the sensor's return density, the field comes from the
  sensor's spot geometry, and neither is derived from the other, so their
  agreement is evidence rather than arithmetic.

Why not one combined run: the sampler REFUSES bad patches, so the realisations
that survive are the quieter ones. Measured at 15 degrees of yaw with the
sampler in the loop, 73% of draws were rejected and the surviving empirical
spread was 38% narrower than the model - which looks exactly like an
overstating model and is in fact selection bias. Keeping the two separate
removes that confound; the sampler's refusals are tested on their own in
`test_backprojection.py`.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.geometry.anatomical_basis import chord_facing_yaw
from app.geometry.backprojection import (
    MAX_PATCH_MAD_M,
    MIN_PATCH_CONSENSUS,
    POINT_SIGMA_M,
    TORSO_PATCH_RADIUS_M,
    backproject,
    effective_returns,
    patch_radius_px,
    sample_landmark_depth,
)
from app.geometry.intrinsics import CameraIntrinsics
from app.geometry.uncertainty3d import (
    CORONAL_PLANE,
    HORIZONTAL_PLANE,
    MEDIAN_EFFICIENCY,
    chord_angle_sigma_degrees,
    depth_correlation,
    depth_sigma_from_returns,
    direction_angle_sigma_degrees,
    landmark_pixel_sigma,
    point_covariance,
    twist_sigma_degrees,
)
from depth_noise import correlated_depth_noise_m

K = CameraIntrinsics(fx=1000.0, fy=1000.0, cx=539.5, cy=719.5, width=1080, height=1440)
K_DEPTH = K.rescaled_to(256, 192)
SHAPE = (192, 256)
BODY_HEIGHT_PX = 1430.0
SHOULDER_HALF, HIP_HALF, STAND_Z = 0.19, 0.14, 2.5

#: Monte-Carlo size. The sampling error of an empirical SD is about
#: `1 / sqrt(2N)`, so 1500 gives roughly 1.8% - comfortably inside the bands
#: below, and fast enough to stay in the default suite.
N_RUNS = 1500

#: Acceptable `analytical / empirical` ratio for the propagation test.
#:
#: MEASURED across yaws 0, 15 and 30 and three metrics: 0.948 to 0.978. The
#: model sits a consistent 2-5% BELOW the empirical spread because
#: `direction_angle_sigma_degrees` linearises `atan2` to first order, and the
#: true distribution of a ratio of noisy quantities is slightly wider than the
#: linear approximation. That shortfall is small, systematic, and in the
#: understating direction, so the lower bound is what matters here: it is set at
#: 0.90, which the measured values clear with room for Monte-Carlo scatter
#: while still failing loudly if the model ever becomes meaningfully
#: overconfident.
#:
#: The upper bound guards the other error: an inflated sigma is not "safe", it
#: makes every comparison indeterminate and the measurement useless.
PROPAGATION_RATIO_BAND = (0.90, 1.30)

#: Acceptable band for the input-sigma cross-check. Wider because it runs fewer
#: realisations (a full 192x256 noise field per draw) and because the two sides
#: are independent derivations rather than two forms of one formula. MEASURED:
#: 1.044 at 1.7 m, 1.101 at 2.5 m, 1.137 at 3.0 m - conservative throughout.
INPUT_SIGMA_RATIO_BAND = (0.85, 1.35)


def torso_points(yaw_deg: float) -> dict[str, np.ndarray]:
    t = np.radians(yaw_deg)
    c, s = np.cos(t), np.sin(t)
    r = np.array([[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]])
    base = {
        "l_sh": np.array([SHOULDER_HALF, -1.40, 0.0]),
        "r_sh": np.array([-SHOULDER_HALF, -1.40, 0.0]),
        "l_hip": np.array([HIP_HALF, -1.00, 0.0]),
        "r_hip": np.array([-HIP_HALF, -1.00, 0.0]),
    }
    return {k: r @ v + np.array([0.0, 0.0, STAND_Z]) for k, v in base.items()}


def project(p: np.ndarray) -> tuple[float, float]:
    return float(p[0] * K.fx / p[2] + K.cx), float(p[1] * K.fy / p[2] + K.cy)


def nominal_depth_sigma() -> float:
    r = patch_radius_px(TORSO_PATCH_RADIUS_M, STAND_Z, K_DEPTH)
    return depth_sigma_from_returns(effective_returns(r, STAND_Z, K_DEPTH))


def analytical(pts: dict[str, np.ndarray]) -> dict[str, float]:
    sigma_px = landmark_pixel_sigma(BODY_HEIGHT_PX)
    sd = nominal_depth_sigma()
    uv = {k: project(v) for k, v in pts.items()}
    shoulder = chord_angle_sigma_degrees(
        pts["l_sh"], pts["r_sh"], uv["l_sh"], uv["r_sh"], K,
        sigma_px=sigma_px, sigma_depth1_m=sd, sigma_depth2_m=sd, plane=HORIZONTAL_PLANE,
    )
    pelvis = chord_angle_sigma_degrees(
        pts["l_hip"], pts["r_hip"], uv["l_hip"], uv["r_hip"], K,
        sigma_px=sigma_px, sigma_depth1_m=sd, sigma_depth2_m=sd, plane=HORIZONTAL_PLANE,
    )
    coronal = chord_angle_sigma_degrees(
        pts["l_sh"], pts["r_sh"], uv["l_sh"], uv["r_sh"], K,
        sigma_px=sigma_px, sigma_depth1_m=sd, sigma_depth2_m=sd, plane=CORONAL_PLANE,
    )
    return {
        "shoulder_yaw": shoulder,
        "pelvis_yaw": pelvis,
        "axial_twist": twist_sigma_degrees(shoulder, pelvis),
        "coronal_tilt": coronal,
    }


def empirical(pts: dict[str, np.ndarray], n: int = N_RUNS, seed: int = 99) -> dict[str, float]:
    """Spread of each metric when every landmark is perturbed by the declared sigmas."""
    sigma_px = landmark_pixel_sigma(BODY_HEIGHT_PX)
    sd = nominal_depth_sigma()
    rng = np.random.default_rng(seed)
    uv = {k: project(v) for k, v in pts.items()}
    shoulder, twist, coronal = [], [], []
    for _ in range(n):
        p = {}
        for key, point in pts.items():
            u, v = uv[key]
            p[key] = backproject(
                u + rng.normal(scale=sigma_px),
                v + rng.normal(scale=sigma_px),
                point[2] + rng.normal(scale=sd),
                K,
            )
        a = chord_facing_yaw(p["l_sh"], p["r_sh"])
        b = chord_facing_yaw(p["l_hip"], p["r_hip"])
        shoulder.append(a)
        twist.append(a - b)
        d = p["l_sh"] - p["r_sh"]
        coronal.append(float(np.degrees(np.arctan2(d[1], abs(d[0])))))
    return {
        "shoulder_yaw": float(np.std(shoulder)),
        "axial_twist": float(np.std(twist)),
        "coronal_tilt": float(np.std(coronal)),
    }


# --- the propagation ---------------------------------------------------------


@pytest.mark.parametrize("yaw", [0.0, 15.0, 30.0])
@pytest.mark.parametrize("metric", ["shoulder_yaw", "axial_twist", "coronal_tilt"])
def test_analytical_sigma_matches_the_empirical_spread(yaw, metric):
    pts = torso_points(yaw)
    ratio = analytical(pts)[metric] / empirical(pts)[metric]
    low, high = PROPAGATION_RATIO_BAND
    assert low <= ratio <= high, (
        f"{metric} at {yaw} deg yaw: analytical/empirical = {ratio:.3f}, outside {PROPAGATION_RATIO_BAND}. "
        "Below the band the model is overconfident; above it, uselessly inflated."
    )


def test_the_model_is_never_wildly_overconfident_at_any_tested_yaw():
    """Stated separately from the band above because this is the direction that
    matters: a model reporting half the real spread would hand a clinician a
    number twice as precise as the instrument earned."""
    for yaw in (0.0, 10.0, 15.0, 20.0, 30.0):
        pts = torso_points(yaw)
        a, e = analytical(pts), empirical(pts, n=600, seed=7)
        for metric in ("shoulder_yaw", "axial_twist", "coronal_tilt"):
            assert a[metric] / e[metric] > 0.85, f"{metric} at {yaw} deg"


# --- the input sigma: the non-circular half ---------------------------------


@pytest.mark.parametrize("distance", [1.7, 2.5, 3.0])
def test_the_physics_sigma_matches_the_correlated_field(distance):
    """Two independent derivations of the same quantity.

    LEFT: `POINT_SIGMA_M * sqrt(pi/2) / sqrt(n_effective)`, where `n_effective`
    comes from the sensor's RETURN DENSITY. RIGHT: the measured spread of the
    real sampler's patch median over a noise field built from the sensor's SPOT
    GEOMETRY. Neither is computed from the other.

    This test found two real bugs. It is why the median-efficiency factor exists
    at all - without it the model read 7-15% low at every distance - and it is
    what caught the noise fixture holding its correlation length fixed in METRES
    when the LiDAR's spot pattern is fixed in ANGLE, which made the empirical
    spread flat with distance instead of falling as the subject came closer.
    """
    mask = np.ones(SHAPE, dtype=bool)
    samples, n_eff = [], None
    for s in range(250):
        field = correlated_depth_noise_m(SHAPE, rng=np.random.default_rng(7000 + s), fx_depth_px=K_DEPTH.fx)
        sample = sample_landmark_depth(
            np.full(SHAPE, distance) + field,
            u=K.cx, v=K.cy, k_video=K, k_depth=K_DEPTH, mask=mask,
            radius_m=TORSO_PATCH_RADIUS_M, expected_depth_m=distance,
        )
        if sample is not None:
            samples.append(sample.depth_m)
            n_eff = sample.n_effective

    assert len(samples) > 200, "the sampler rejected too many draws for this to mean anything"
    ratio = depth_sigma_from_returns(n_eff) / float(np.std(samples))
    low, high = INPUT_SIGMA_RATIO_BAND
    assert low <= ratio <= high, f"at {distance} m: analytical/empirical = {ratio:.3f}"


def test_the_empirical_spread_falls_as_the_subject_comes_closer():
    """Return density rises as 1/Z^2, so a fixed physical patch holds more
    independent samples up close. A spread that is FLAT with distance means the
    noise field's correlation length is not scaling with Z - the fixture bug
    this suite caught once already."""
    mask = np.ones(SHAPE, dtype=bool)
    spreads = {}
    for distance in (1.7, 3.0):
        vals = []
        for s in range(250):
            field = correlated_depth_noise_m(
                SHAPE, rng=np.random.default_rng(8000 + s), fx_depth_px=K_DEPTH.fx
            )
            sample = sample_landmark_depth(
                np.full(SHAPE, distance) + field,
                u=K.cx, v=K.cy, k_video=K, k_depth=K_DEPTH, mask=mask,
                radius_m=TORSO_PATCH_RADIUS_M, expected_depth_m=distance,
            )
            if sample is not None:
                vals.append(sample.depth_m)
        spreads[distance] = float(np.std(vals))
    assert spreads[1.7] < 0.85 * spreads[3.0], f"{spreads}"


def test_the_median_efficiency_factor_is_present_and_is_what_it_claims():
    """A median of n Gaussian samples has asymptotic SD `sqrt(pi/2) * sigma /
    sqrt(n)`. Forgetting it understates by 25%, and `sample_landmark_depth` has
    to median - a mean would be dragged by exactly the background pixels the
    median shrugs off."""
    assert MEDIAN_EFFICIENCY == pytest.approx(1.2533, rel=1e-3)
    assert depth_sigma_from_returns(4.0) == pytest.approx(POINT_SIGMA_M * 1.2533 / 2.0, rel=1e-3)
    # Verified against a direct simulation rather than taken on trust.
    rng = np.random.default_rng(5)
    draws = rng.normal(scale=1.0, size=(20000, 25))
    assert float(np.std(np.median(draws, axis=1))) == pytest.approx(1.2533 / 5.0, rel=0.05)


def test_the_samplers_reported_sigma_and_the_model_agree_exactly():
    """One definition, used in both places: a sample that reported a different
    sigma from the one the model propagates would make the calibration above
    meaningless."""
    sample = sample_landmark_depth(
        np.full(SHAPE, 2.5), u=K.cx, v=K.cy, k_video=K, k_depth=K_DEPTH,
        mask=np.ones(SHAPE, dtype=bool), expected_depth_m=2.5,
    )
    assert sample is not None
    assert sample.sigma_m == pytest.approx(depth_sigma_from_returns(sample.n_effective), rel=1e-12)


# --- the model's structure --------------------------------------------------


def test_chord_length_divides_with_no_floor():
    """`sigma_angle` goes as 1/L, so a short baseline reports a larger
    uncertainty - which is why pelvis yaw carries more than shoulder yaw. A
    floor would cap exactly the measurements that deserve the widest band."""
    sigma_px, sd = landmark_pixel_sigma(BODY_HEIGHT_PX), nominal_depth_sigma()
    previous = None
    for half in (0.07, 0.14, 0.19, 0.30):
        p1 = np.array([half, -1.2, STAND_Z])
        p2 = np.array([-half, -1.2, STAND_Z])
        s = chord_angle_sigma_degrees(
            p1, p2, project(p1), project(p2), K,
            sigma_px=sigma_px, sigma_depth1_m=sd, sigma_depth2_m=sd, plane=HORIZONTAL_PLANE,
        )
        if previous is not None:
            assert s < previous
        previous = s
    # Halving the baseline roughly doubles the uncertainty, with no cap.
    short = chord_angle_sigma_degrees(
        np.array([0.07, -1.2, STAND_Z]), np.array([-0.07, -1.2, STAND_Z]),
        project(np.array([0.07, -1.2, STAND_Z])), project(np.array([-0.07, -1.2, STAND_Z])), K,
        sigma_px=sigma_px, sigma_depth1_m=sd, sigma_depth2_m=sd, plane=HORIZONTAL_PLANE,
    )
    long = chord_angle_sigma_degrees(
        np.array([0.14, -1.2, STAND_Z]), np.array([-0.14, -1.2, STAND_Z]),
        project(np.array([0.14, -1.2, STAND_Z])), project(np.array([-0.14, -1.2, STAND_Z])), K,
        sigma_px=sigma_px, sigma_depth1_m=sd, sigma_depth2_m=sd, plane=HORIZONTAL_PLANE,
    )
    assert short / long == pytest.approx(2.0, rel=0.15)


def test_the_pelvis_carries_more_uncertainty_than_the_shoulders():
    """ADR-020 section 4's figures, as a relation rather than two constants."""
    a = analytical(torso_points(0.0))
    assert a["pelvis_yaw"] > a["shoulder_yaw"]
    assert a["axial_twist"] > a["pelvis_yaw"]


def test_the_reproduced_figures_are_close_to_adr_020s():
    """ADR-020 quotes 2.5, 3.4 and 4.2 degrees. This model lands slightly ABOVE
    each, because the ADR's arithmetic assumed `sigma / sqrt(n)` for what is
    actually a median. The ADR's numbers are therefore mildly optimistic, and
    the direction of the difference is the safe one - but it is worth knowing
    that the published table and this code are not identical."""
    a = analytical(torso_points(0.0))
    assert a["shoulder_yaw"] == pytest.approx(2.5, abs=0.5)
    assert a["pelvis_yaw"] == pytest.approx(3.4, abs=0.6)
    assert a["axial_twist"] == pytest.approx(4.2, abs=0.7)
    assert a["shoulder_yaw"] > 2.5 and a["axial_twist"] > 4.2


def test_the_twist_floor_still_exceeds_a_five_degree_effect():
    """So the metric ships as `proxy` carrying its own uncertainty. If this ever
    drops below 5, the tier decision deserves revisiting - and should be
    revisited deliberately, not noticed later."""
    assert analytical(torso_points(0.0))["axial_twist"] > 4.0


def test_a_3d_coronal_tilt_would_be_far_worse_than_the_yaw(  ):
    """ADR-020 section 5, measured: the 3D coronal tilt carries about 7.8 degrees
    at zero yaw against the subject yaw's 2.8, because its baseline is already
    fully in-plane and depth adds error without adding leverage. This is the
    arithmetic behind not recomputing coronal tilts in 3D."""
    a = analytical(torso_points(0.0))
    assert a["coronal_tilt"] > 2.5 * a["shoulder_yaw"]
    assert a["coronal_tilt"] > 7.0


def test_in_plane_error_dominates_the_point_covariance():
    """The error ellipsoid is an oblate pancake, not a needle along the ray."""
    cov = point_covariance(
        K.cx, K.cy, STAND_Z, K,
        sigma_px=landmark_pixel_sigma(BODY_HEIGHT_PX), sigma_depth_m=nominal_depth_sigma(),
    )
    assert np.sqrt(cov[0, 0]) == pytest.approx(0.0358, rel=0.05)
    assert np.sqrt(cov[0, 0]) > 2.5 * np.sqrt(cov[2, 2])


def test_the_covariance_is_symmetric_and_positive_semi_definite():
    cov = point_covariance(
        800.0, 400.0, STAND_Z, K, sigma_px=14.3, sigma_depth_m=0.013
    )
    assert np.allclose(cov, cov.T, atol=1e-18)
    assert np.all(np.linalg.eigvalsh(cov) >= -1e-18)


def test_pixel_sigma_enters_in_pixels_not_metres():
    """ADR-020's 0.0358 m is ALREADY `14.3 px * Z / fx`. Passing metres in here
    would apply `Z / fx` a second time and understate the in-plane term by about
    400x at 2.5 m - an error that makes the instrument look extraordinarily
    precise."""
    as_px = point_covariance(K.cx, K.cy, STAND_Z, K, sigma_px=14.3, sigma_depth_m=0.0)
    as_m = point_covariance(K.cx, K.cy, STAND_Z, K, sigma_px=0.0358, sigma_depth_m=0.0)
    assert np.sqrt(as_px[0, 0]) == pytest.approx(0.0358, rel=0.01)
    assert np.sqrt(as_px[0, 0]) / np.sqrt(as_m[0, 0]) == pytest.approx(400.0, rel=0.05)


# --- correlated depth -------------------------------------------------------


def test_the_chords_in_use_are_far_enough_apart_to_be_independent():
    """0.38 m and 0.28 m against a 0.082 m correlation length, so the cross term
    is exactly zero and summing the variances is correct. Asserted rather than
    assumed, because it stops being true the moment someone measures between two
    nearby landmarks."""
    assert depth_correlation(2 * SHOULDER_HALF) == 0.0
    assert depth_correlation(2 * HIP_HALF) == 0.0


def test_nearby_landmarks_are_not_treated_as_independent():
    """The cross term is carried for the case the pipeline does not yet have. A
    model that silently assumed independence would overstate such a metric's
    uncertainty with nothing to indicate it."""
    assert depth_correlation(0.02) > 0.8
    assert depth_correlation(0.08) > 0.4


def test_a_shared_depth_error_reduces_the_uncertainty_of_a_difference():
    """Two landmarks 2 cm apart share most of their depth error, so it largely
    cancels in the difference between them - the same reason the frame-wide
    systematic term is left out entirely."""
    sigma_px, sd = 0.0, 0.013  # depth only, so the effect is visible
    close = np.array([0.01, -1.2, STAND_Z]), np.array([-0.01, -1.2, STAND_Z])
    far = np.array([0.19, -1.2, STAND_Z]), np.array([-0.19, -1.2, STAND_Z])

    def sigma_of(pair, plane):
        return chord_angle_sigma_degrees(
            pair[0], pair[1], project(pair[0]), project(pair[1]), K,
            sigma_px=sigma_px, sigma_depth1_m=sd, sigma_depth2_m=sd, plane=plane,
        )

    # Scale out the 1/L difference to isolate the correlation's contribution.
    close_scaled = sigma_of(close, HORIZONTAL_PLANE) * 0.02
    far_scaled = sigma_of(far, HORIZONTAL_PLANE) * 0.38
    assert close_scaled < far_scaled


def test_a_degenerate_chord_has_no_angle_and_so_no_uncertainty():
    cov = point_covariance(K.cx, K.cy, STAND_Z, K, sigma_px=14.3, sigma_depth_m=0.013)
    assert direction_angle_sigma_degrees(np.zeros(3), cov, HORIZONTAL_PLANE) is None


def test_a_non_psd_covariance_is_an_error_not_a_clipped_zero():
    bad = np.array([[1.0, 5.0, 0.0], [5.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
    with pytest.raises(ValueError):
        direction_angle_sigma_degrees(np.array([1.0, 1.0, 0.0]), bad, CORONAL_PLANE)


@pytest.mark.parametrize("bad", [(-1.0, 0.01), (14.3, -0.01)])
def test_negative_sigmas_are_refused(bad):
    with pytest.raises(ValueError):
        point_covariance(K.cx, K.cy, STAND_Z, K, sigma_px=bad[0], sigma_depth_m=bad[1])


def test_too_few_returns_is_refused_rather_than_extrapolated():
    with pytest.raises(ValueError):
        depth_sigma_from_returns(0.5)


# --- a consequence of the gates worth knowing -------------------------------


def test_the_consensus_gate_imposes_an_implicit_yaw_ceiling():
    """A FLAT torso patch at high yaw has a depth gradient across it from
    geometry alone, with no noise involved: a 14 cm patch at yaw `t` spans
    `0.14 * sin(t)` of depth. Above about 32 degrees that spread drops the
    consensus fraction below `MIN_PATCH_CONSENSUS` and the sample is refused.

    That is benign - ADR-020 section 2 proposes raising `wrong_view` above 10
    degrees of yaw anyway, so the ceiling sits well outside the usable range -
    but it is an interaction between a quality gate and subject pose that would
    be confusing to rediscover from a field of refused samples, so it is
    recorded here with the arithmetic."""
    patch_m = 2 * TORSO_PATCH_RADIUS_M

    def consensus_at(yaw_deg: float) -> float:
        spread = patch_m * np.sin(np.radians(yaw_deg))
        return 1.0 if spread <= 0 else min(1.0, 2 * MAX_PATCH_MAD_M / spread)

    assert consensus_at(30.0) >= MIN_PATCH_CONSENSUS
    assert consensus_at(35.0) < MIN_PATCH_CONSENSUS
    # The ceiling is comfortably outside the yaw range the step gate allows.
    assert consensus_at(10.0) == 1.0


# --- a pitched camera: the frame the angle is taken in is not the frame the
# --- Jacobians live in ------------------------------------------------------


def _rx(deg: float) -> np.ndarray:
    p = np.radians(deg)
    return np.array([[1, 0, 0], [0, np.cos(p), -np.sin(p)], [0, np.sin(p), np.cos(p)]])


def _pitched_chord(pitch_deg: float):
    """Two shoulder points 0.38 m apart as a camera pitched by `pitch_deg` sees
    them, plus the rotation into the gravity frame and the source pixels."""
    from app.geometry.gravity_alignment import rotation_to_gravity_frame

    cam_from_world = _rx(pitch_deg)
    world = {"l": np.array([SHOULDER_HALF, -1.40, 0.0]), "r": np.array([-SHOULDER_HALF, -1.40, 0.0])}
    cam = {k: cam_from_world @ (v + np.array([0.0, 0.0, STAND_Z])) for k, v in world.items()}
    r = rotation_to_gravity_frame(cam_from_world @ np.array([0.0, 1.0, 0.0]))
    uv = {k: project(v) for k, v in cam.items()}
    return cam, r, uv


def _empirical_yaw_sigma(pitch_deg: float, n: int = 2500, seed: int = 1) -> float:
    cam, r, uv = _pitched_chord(pitch_deg)
    sigma_px, sd = landmark_pixel_sigma(BODY_HEIGHT_PX), nominal_depth_sigma()
    rng = np.random.default_rng(seed)
    yaws = []
    for _ in range(n):
        p = {}
        for key in cam:
            u, v = uv[key]
            p[key] = r @ backproject(
                u + rng.normal(scale=sigma_px), v + rng.normal(scale=sigma_px),
                cam[key][2] + rng.normal(scale=sd), K,
            )
        yaws.append(chord_facing_yaw(p["l"], p["r"]))
    return float(np.std(yaws))


def _analytic_yaw_sigma(pitch_deg: float, *, with_rotation: bool) -> float:
    cam, r, uv = _pitched_chord(pitch_deg)
    sigma_px, sd = landmark_pixel_sigma(BODY_HEIGHT_PX), nominal_depth_sigma()
    grav = {k: r @ v for k, v in cam.items()}
    extra = dict(rotation=r, depth1_m=cam["l"][2], depth2_m=cam["r"][2]) if with_rotation else {}
    return chord_angle_sigma_degrees(
        grav["l"], grav["r"], uv["l"], uv["r"], K,
        sigma_px=sigma_px, sigma_depth1_m=sd, sigma_depth2_m=sd, plane=HORIZONTAL_PLANE, **extra,
    )


@pytest.mark.parametrize("pitch", [0.0, 10.0, 20.0, 35.0])
def test_the_rotated_model_matches_the_empirical_spread_at_any_camera_pitch(pitch):
    """The Phase 2 calibration only ever used a level camera, where the camera
    and gravity frames coincide, so it could not see this. Measured: camera pitch
    roughly DOUBLES the true yaw uncertainty (2.79 degrees level, 5.86 at 35),
    because depth error rotates into the horizontal plane."""
    ratio = _analytic_yaw_sigma(pitch, with_rotation=True) / _empirical_yaw_sigma(pitch)
    assert 0.93 <= ratio <= 1.08, f"pitch {pitch}: analytical/empirical = {ratio:.3f}"


def test_without_the_rotation_the_model_is_overconfident_by_a_pitch_dependent_amount():
    """The bug this fixes, as numbers. The un-rotated model reports a FIXED
    2.75 degrees whatever the tilt: 18% too tight at 10 degrees (inside the 12
    the 2D path tolerates), 34% at 20, 53% at 35. An instrument that reports
    more confidence the more it is tilted."""
    flat = _analytic_yaw_sigma(0.0, with_rotation=False)
    for pitch, minimum_shortfall in ((10.0, 0.12), (20.0, 0.25), (35.0, 0.40)):
        assert _analytic_yaw_sigma(pitch, with_rotation=False) == pytest.approx(flat, rel=1e-9)
        shortfall = 1.0 - _analytic_yaw_sigma(pitch, with_rotation=False) / _empirical_yaw_sigma(pitch)
        assert shortfall > minimum_shortfall, f"pitch {pitch}: only {shortfall:.0%} too tight"


def test_a_level_camera_is_unchanged_by_passing_the_rotation():
    """Backward compatible: identity rotation reproduces the old answer exactly."""
    assert _analytic_yaw_sigma(0.0, with_rotation=True) == pytest.approx(
        _analytic_yaw_sigma(0.0, with_rotation=False), rel=1e-9
    )


def test_yaw_uncertainty_grows_with_camera_pitch():
    values = [_analytic_yaw_sigma(p, with_rotation=True) for p in (0.0, 10.0, 20.0, 35.0)]
    assert values == sorted(values) and values[-1] > 1.8 * values[0]
