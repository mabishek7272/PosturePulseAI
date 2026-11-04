"""Analytical uncertainty for angles measured from back-projected 3D points.

Everything here propagates `Sigma_theta = J Sigma J^T` and then differentiates
`atan2`. Three things about it are load-bearing.

**The input covariance is in `(u, v, Z)`, not metres.** The in-plane sigma that
ADR-020 quotes, 0.0358 m, is ALREADY `14.3 px * Z / fx` - the Jacobian applied.
Feeding 0.0358 m into `J` again would scale it by `Z / fx` a second time and
understate the in-plane term by about 400x at 2.5 m. So the pixel sigma goes in,
in pixels, and `J` does the one conversion there is to do.

**The depth sigma comes from physics, never from the test fixture.** It is
`POINT_SIGMA_M / sqrt(n_effective)`, where `n_effective` is the independent
LiDAR returns the patch is estimated to hold - a count derived from the sensor's
return density. It is deliberately NOT the measured patch-median attenuation of
the synthetic noise field (about 0.618 of sigma at 11x11). Using the fixture's
own attenuation here would make the Monte-Carlo calibration test circular: the
analytical sigma would be derived from the fixture, compared against the
fixture, and would agree no matter how wrong both were. The two must be derived
independently so that their agreement is evidence. They land within about 14% of
each other (0.0141 m from the return count against 0.0124 m from the field),
and `test_uncertainty3d_calibration.py` asserts that agreement as a result
rather than assuming it as an input.

**Chord length divides, with no floor.** `sigma_angle` goes as `1 / L`, so a
short baseline amplifies the error and says so. A floor would cap the reported
uncertainty of exactly the measurements that deserve the largest - a pelvis
chord is 0.28 m against a shoulder's 0.38, which is the whole reason pelvis yaw
carries 3.4 degrees against the shoulder's 2.5.

Correlated depth error, and when it matters
-------------------------------------------
Most of the depth error is spatially correlated over about 8.2 cm. For two
landmarks much further apart than that, the errors are effectively independent
and the difference's variance is the sum - which is what the chords in use give:
0.38 m and 0.28 m are 4.6 and 3.4 correlation lengths apart. The cross term is
carried anyway, because it is NOT negligible for any future metric taken between
nearby landmarks, and a model that silently assumed independence would overstate
that metric's uncertainty without anything indicating it.

The systematic depth component (~0.035 m, correlated across the whole frame) is
deliberately absent: every quantity here is a DIFFERENCE between two landmarks,
and a frame-wide offset cancels exactly in a difference. Including it would
inflate every reported uncertainty by a term that cannot affect the result.
"""
from __future__ import annotations

import numpy as np

from app.geometry.backprojection import POINT_SIGMA_M, backproject_jacobian
from app.geometry.intrinsics import CameraIntrinsics

#: In-plane landmark sigma as a fraction of body height in pixels. Mirrors
#: `POSITION_SD_FRACTION` in app/metrics/static_metrics.py, which is a declared
#: engineering guess ("DRAFT - engineering defaults, not derived from data").
#: Kept identical on purpose: the 2D and 3D paths must not disagree about how
#: well a landmark is localised.
POSITION_SD_FRACTION = 0.01

#: Fraction of depth variance that is spatially correlated (ADR-020 section 4).
CORRELATED_DEPTH_FRACTION = 0.85

#: Correlation length of the depth error, metres: the mean spacing between
#: independent LiDAR returns at the reference distance, `1 / sqrt(150)`.
DEPTH_CORRELATION_LENGTH_M = 0.082

#: Plane selectors for `direction_angle_sigma_degrees`, as index pairs into
#: `(x, y, z)`. Coronal angles live in the image plane (x, y); yaw lives in the
#: horizontal plane (x, z).
CORONAL_PLANE = (0, 1)
HORIZONTAL_PLANE = (0, 2)


def landmark_pixel_sigma(body_height_px: float, fraction: float = POSITION_SD_FRACTION) -> float:
    """In-plane landmark sigma in pixels, from the body's pixel height."""
    if body_height_px <= 0:
        raise ValueError("body_height_px must be positive")
    return fraction * body_height_px


#: Efficiency penalty for estimating a centre with a MEDIAN rather than a mean.
#: The median of `n` Gaussian samples has asymptotic SD `sqrt(pi/2) * sigma /
#: sqrt(n)`, about 25% wider than the mean's `sigma / sqrt(n)`.
#:
#: `sample_landmark_depth` medians its patch on purpose - it has to, because a
#: mean would be dragged by the background pixels the median shrugs off - so the
#: uncertainty model has to pay for it. Omitting this factor made the analytical
#: sigma come out 7-15% BELOW the empirical spread across 1.7-3.0 m, which is
#: the understating direction: the instrument would have reported slightly more
#: confidence than it had, at every distance.
MEDIAN_EFFICIENCY = float(np.sqrt(np.pi / 2.0))


def depth_sigma_from_returns(n_effective: float, point_sigma_m: float = POINT_SIGMA_M) -> float:
    """Random depth sigma of a patch MEDIAN over `n_effective` independent returns.

    Only the RANDOM component shrinks with independent samples. See the module
    docstring on why this is not taken from the noise fixture, and
    `MEDIAN_EFFICIENCY` on why it is not simply `sigma / sqrt(n)`.
    """
    if n_effective < 1.0:
        raise ValueError("n_effective must be at least 1")
    return point_sigma_m * MEDIAN_EFFICIENCY / float(np.sqrt(n_effective))


def point_covariance(
    u: float,
    v: float,
    depth_m: float,
    k: CameraIntrinsics,
    *,
    sigma_px: float,
    sigma_depth_m: float,
) -> np.ndarray:
    """`(3, 3)` covariance of one back-projected point, in metres squared.

    The result is anisotropic and must stay a matrix. At 2.5 m it is an oblate
    pancake - in-plane sigma 0.0358 m against depth 0.0117 - not a needle along
    the viewing ray, and collapsing it to a scalar would lose the direction the
    error actually points in, which is what every angle below depends on.
    """
    if sigma_px < 0 or sigma_depth_m < 0:
        raise ValueError("sigmas must not be negative")
    j = backproject_jacobian(u, v, depth_m, k)
    sigma_uvz = np.diag([sigma_px**2, sigma_px**2, sigma_depth_m**2])
    return j @ sigma_uvz @ j.T


def depth_cross_covariance(
    u1: float,
    v1: float,
    u2: float,
    v2: float,
    depth1_m: float,
    depth2_m: float,
    k: CameraIntrinsics,
    *,
    sigma_depth1_m: float,
    sigma_depth2_m: float,
    separation_m: float,
    correlation_length_m: float = DEPTH_CORRELATION_LENGTH_M,
) -> np.ndarray:
    """`(3, 3)` cross-covariance between two points, from correlated depth only.

    In-plane landmark error is not shared between landmarks - the pose model
    localises each one separately - so only the depth term contributes here.
    """
    rho = depth_correlation(separation_m, correlation_length_m)
    if rho <= 0.0:
        return np.zeros((3, 3))
    j1 = backproject_jacobian(u1, v1, depth1_m, k)
    j2 = backproject_jacobian(u2, v2, depth2_m, k)
    shared = CORRELATED_DEPTH_FRACTION * rho * sigma_depth1_m * sigma_depth2_m
    sigma_cross = np.zeros((3, 3))
    sigma_cross[2, 2] = shared
    return j1 @ sigma_cross @ j2.T


def depth_correlation(separation_m: float, correlation_length_m: float = DEPTH_CORRELATION_LENGTH_M) -> float:
    """Correlation between two landmarks' depth errors at this separation.

    A triangular kernel vanishing at twice the correlation length. It is an
    APPROXIMATION, and its only real job is to say when the cross term is
    negligible: for the chords this pipeline uses (0.38 m and 0.28 m against a
    0.082 m correlation length) it returns exactly zero, and the calibration
    test confirms independence empirically rather than taking this kernel's word
    for it.
    """
    if correlation_length_m <= 0:
        raise ValueError("correlation_length_m must be positive")
    d = abs(float(separation_m))
    return float(max(0.0, 1.0 - d / (2.0 * correlation_length_m)))


def difference_covariance(
    cov1: np.ndarray, cov2: np.ndarray, cross: np.ndarray | None = None
) -> np.ndarray:
    """Covariance of `p2 - p1`.

    `C1 + C2 - cross - cross^T`. With no cross term this is the sum, which is
    the correct independent case and the one the chords in use fall into.
    """
    c = np.asarray(cov1, dtype=float) + np.asarray(cov2, dtype=float)
    if cross is not None:
        x = np.asarray(cross, dtype=float)
        c = c - x - x.T
    return c


def direction_angle_sigma_degrees(
    delta: np.ndarray, cov_delta: np.ndarray, plane: tuple[int, int] = CORONAL_PLANE
) -> float | None:
    """Uncertainty of `atan2` of a 2-D projection of `delta`, in degrees.

    For `theta = atan2(b, a)` the gradient is `(-b, a) / L^2` with
    `L^2 = a^2 + b^2`, so

        var(theta) = (b^2 var(a) - 2 a b cov(a,b) + a^2 var(b)) / L^4

    The `1 / L^2` is where chord length enters, and it is why a short baseline
    reports a large uncertainty rather than being floored into looking as good
    as a long one.

    `None` when the chord has no extent in the chosen plane - there is no angle
    to attach an uncertainty to, which is a refusal and not a zero.
    """
    d = np.asarray(delta, dtype=float).reshape(3)
    c = np.asarray(cov_delta, dtype=float)
    if c.shape != (3, 3):
        raise ValueError("cov_delta must be (3, 3)")
    i, j = plane
    a, b = float(d[i]), float(d[j])
    length_sq = a * a + b * b
    if length_sq < 1e-12:
        return None

    var_a, var_b, cov_ab = float(c[i, i]), float(c[j, j]), float(c[i, j])
    variance = (b * b * var_a - 2.0 * a * b * cov_ab + a * a * var_b) / (length_sq**2)
    if variance < 0.0:
        # Only reachable from a non-PSD input covariance, which is a caller bug
        # rather than a small negative to be clipped away silently.
        raise ValueError("cov_delta is not positive semi-definite in this plane")
    return float(np.degrees(np.sqrt(variance)))


def chord_angle_sigma_degrees(
    p1: np.ndarray,
    p2: np.ndarray,
    uv1: tuple[float, float],
    uv2: tuple[float, float],
    k: CameraIntrinsics,
    *,
    sigma_px: float,
    sigma_depth1_m: float,
    sigma_depth2_m: float,
    plane: tuple[int, int] = CORONAL_PLANE,
) -> float | None:
    """End-to-end uncertainty of the angle of the chord `p1 -> p2`, in degrees.

    `p1`/`p2` are the back-projected points in metres (in whatever frame the
    angle is to be taken in); `uv1`/`uv2` are their source pixels, needed for the
    Jacobians. The depth cross-covariance is included automatically, using the
    points' own 3D separation.
    """
    a = np.asarray(p1, dtype=float).reshape(3)
    b = np.asarray(p2, dtype=float).reshape(3)
    separation = float(np.linalg.norm(b - a))

    cov1 = point_covariance(*uv1, a[2], k, sigma_px=sigma_px, sigma_depth_m=sigma_depth1_m)
    cov2 = point_covariance(*uv2, b[2], k, sigma_px=sigma_px, sigma_depth_m=sigma_depth2_m)
    cross = depth_cross_covariance(
        *uv1,
        *uv2,
        a[2],
        b[2],
        k,
        sigma_depth1_m=sigma_depth1_m,
        sigma_depth2_m=sigma_depth2_m,
        separation_m=separation,
    )
    return direction_angle_sigma_degrees(b - a, difference_covariance(cov1, cov2, cross), plane)


def twist_sigma_degrees(shoulder_yaw_sigma: float, pelvis_yaw_sigma: float) -> float:
    """Uncertainty of `shoulder_yaw - pelvis_yaw`, in degrees.

    In quadrature, because the two chords are far enough apart that their errors
    are independent - and because both terms are themselves differences, so the
    frame-wide systematic depth offset has already cancelled inside each.

    With ADR-020's figures (2.5 and 3.4) this is 4.2 degrees, which EXCEEDS the
    effect size clinicians usually care about. That is the reason the twist ships
    as `tier: "proxy"` carrying its own uncertainty, rather than as an estimate.
    """
    return float(np.hypot(shoulder_yaw_sigma, pelvis_yaw_sigma))
