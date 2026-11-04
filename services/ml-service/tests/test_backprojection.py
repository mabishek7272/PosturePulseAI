"""app/geometry/backprojection.py - depth sampling and unprojection.

The sampler's whole job is to refuse, so most of this file checks that it does:
every rejection must return `None` rather than a plausible number taken from the
wrong surface.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.geometry.backprojection import (
    EXTREMITY_PATCH_RADIUS_M,
    MIN_PATCH_CONSENSUS,
    MAX_BODY_DEPTH_DEVIATION_M,
    MAX_PATCH_MAD_M,
    MIN_CONFIDENCE,
    MIN_PATCH_PIXELS,
    POINT_SIGMA_M,
    TORSO_PATCH_RADIUS_M,
    backproject,
    backproject_jacobian,
    effective_returns,
    erode_mask,
    patch_radius_px,
    sample_landmark_depth,
)
from app.geometry.intrinsics import CameraIntrinsics
from app.geometry.uncertainty3d import depth_sigma_from_returns

K_VIDEO = CameraIntrinsics(fx=1000.0, fy=1000.0, cx=539.5, cy=719.5, width=1080, height=1440)
K_DEPTH = K_VIDEO.rescaled_to(256, 192)


def flat_scene(depth: float = 2.5, shape=(192, 256)) -> np.ndarray:
    return np.full(shape, depth, dtype=float)


def full_mask(shape=(192, 256)) -> np.ndarray:
    return np.ones(shape, dtype=bool)


# --- unprojection -----------------------------------------------------------


def test_the_principal_point_unprojects_onto_the_optical_axis():
    p = backproject(K_VIDEO.cx, K_VIDEO.cy, 2.5, K_VIDEO)
    assert np.allclose(p, [0.0, 0.0, 2.5], atol=1e-12)


def test_unprojection_round_trips_through_the_projection():
    for u, v, z in [(100.0, 200.0, 2.5), (1000.0, 1300.0, 1.7), (539.5, 719.5, 3.0)]:
        x, y, zz = backproject(u, v, z, K_VIDEO)
        assert x * K_VIDEO.fx / zz + K_VIDEO.cx == pytest.approx(u, abs=1e-9)
        assert y * K_VIDEO.fy / zz + K_VIDEO.cy == pytest.approx(v, abs=1e-9)
        assert zz == pytest.approx(z, abs=1e-12)


def test_depth_is_planar_not_radial():
    """ARKit's `sceneDepth` is distance along the optical axis, so Z == d with no
    `cos` correction. A range map read as planar inflates every off-centre point,
    and the error grows with eccentricity - invisible at the image centre, which
    is where anyone would spot-check it."""
    centre = backproject(K_VIDEO.cx, K_VIDEO.cy, 2.5, K_VIDEO)
    corner = backproject(0.0, 0.0, 2.5, K_VIDEO)
    assert centre[2] == corner[2] == 2.5
    # The corner point is genuinely further from the camera, as range.
    assert np.linalg.norm(corner) > np.linalg.norm(centre)


def test_y_is_down_in_the_unprojected_frame():
    """Frame C's y is image down, and the whole sign chain through
    `gravity_alignment` and `static_metrics` depends on it."""
    above = backproject(K_VIDEO.cx, K_VIDEO.cy - 200.0, 2.5, K_VIDEO)
    below = backproject(K_VIDEO.cx, K_VIDEO.cy + 200.0, 2.5, K_VIDEO)
    assert above[1] < 0 < below[1]


def test_the_jacobians_depth_column_is_the_viewing_ray():
    """Depth error displaces a point ALONG the ray, not along z. That is why the
    full 3x3 covariance has to be carried and never collapsed to a scalar."""
    u, v, z = 800.0, 400.0, 2.5
    j = backproject_jacobian(u, v, z, K_VIDEO)
    p = backproject(u, v, z, K_VIDEO)
    assert np.allclose(j[:, 2], [p[0] / z, p[1] / z, 1.0], atol=1e-12)


def test_the_jacobian_matches_a_numerical_derivative():
    u, v, z, h = 700.0, 900.0, 2.5, 1e-6
    j = backproject_jacobian(u, v, z, K_VIDEO)
    for col, (du, dv, dz) in enumerate([(h, 0, 0), (0, h, 0), (0, 0, h)]):
        numeric = (
            backproject(u + du, v + dv, z + dz, K_VIDEO) - backproject(u - du, v - dv, z - dz, K_VIDEO)
        ) / (2 * h)
        assert np.allclose(j[:, col], numeric, atol=1e-6)


def test_in_plane_error_exceeds_depth_error_at_the_working_distance():
    """ADR-020 section 5 as an assertion on the Jacobian itself: a 14.3 px
    in-plane error maps to 3x the metres a 11.7 mm depth error does. This is the
    reason coronal tilts are NOT recomputed in 3D."""
    j = backproject_jacobian(K_VIDEO.cx, K_VIDEO.cy, 2.5, K_VIDEO)
    in_plane_m = float(np.linalg.norm(j @ np.array([14.3, 0.0, 0.0])))
    depth_m = float(np.linalg.norm(j @ np.array([0.0, 0.0, 0.0117])))
    assert in_plane_m == pytest.approx(0.0358, rel=0.02)
    assert in_plane_m > 3.0 * depth_m


# --- erosion ----------------------------------------------------------------


def test_erosion_removes_the_silhouette_boundary():
    mask = np.zeros((20, 20), dtype=bool)
    mask[5:15, 5:15] = True
    out = erode_mask(mask, 2)
    assert out[7:13, 7:13].all()
    # The two-pixel rim is gone, so no sampled pixel sits where the depth map
    # blends body with room.
    assert not out[5:7, :].any() and not out[:, 5:7].any()
    assert out.sum() == 6 * 6


def test_erosion_in_depth_pixels_not_video_pixels():
    """6 px in the VIDEO grid is 6 * 256/1080 = 1.42 depth px, which erodes about
    one pixel. Stating the kernel in depth pixels is what makes 2 px mean 2 px."""
    assert 6 * 256 / 1080 < 2.0
    mask = np.zeros((40, 40), dtype=bool)
    mask[10:30, 10:30] = True
    assert erode_mask(mask, 2).sum() < erode_mask(mask, 1).sum()


def test_erosion_treats_the_frame_border_as_outside_the_body():
    """A body touching the frame edge has no neighbour beyond it. Treating the
    outside as body would keep exactly the boundary pixels this removes."""
    mask = np.ones((10, 10), dtype=bool)
    out = erode_mask(mask, 1)
    assert not out[0, :].any() and not out[-1, :].any()
    assert out[1:-1, 1:-1].all()


def test_zero_radius_erosion_is_the_identity():
    mask = np.zeros((8, 8), dtype=bool)
    mask[2:6, 2:6] = True
    assert np.array_equal(erode_mask(mask, 0), mask)


def test_erosion_can_empty_a_thin_region_entirely():
    """A forearm a few depth pixels wide erodes to nothing, and the sampler then
    returns None - the correct outcome, not a fallback to the un-eroded mask."""
    mask = np.zeros((20, 20), dtype=bool)
    mask[9:12, 2:18] = True  # 3 px tall
    assert not erode_mask(mask, 2).any()


# --- patch sizing and n_eff -------------------------------------------------


def test_the_patch_covers_a_fixed_amount_of_body_not_a_fixed_pixel_count():
    """A fixed pixel radius would sample a larger piece of the person the
    further away they stood, so the uncertainty would change with distance for
    no physical reason."""
    near = patch_radius_px(TORSO_PATCH_RADIUS_M, 1.7, K_DEPTH)
    far = patch_radius_px(TORSO_PATCH_RADIUS_M, 3.0, K_DEPTH)
    assert near > far
    assert near / far == pytest.approx(3.0 / 1.7, rel=0.2)


def test_an_extremity_patch_is_smaller_than_a_torso_patch():
    assert EXTREMITY_PATCH_RADIUS_M < TORSO_PATCH_RADIUS_M
    assert patch_radius_px(EXTREMITY_PATCH_RADIUS_M, 2.5, K_DEPTH) < patch_radius_px(
        TORSO_PATCH_RADIUS_M, 2.5, K_DEPTH
    )


def test_the_patch_never_degenerates_to_a_single_pixel():
    assert patch_radius_px(TORSO_PATCH_RADIUS_M, 50.0, K_DEPTH) >= 1


def test_effective_returns_are_independent_samples_not_pixel_counts():
    """The number that must drive any averaging claim. Using the patch's PIXEL
    count instead would shrink the reported sigma by roughly the ratio of the
    two - the error the correlated-noise fixture exists to expose."""
    r = patch_radius_px(TORSO_PATCH_RADIUS_M, 2.5, K_DEPTH)
    pixels = (2 * r + 1) ** 2
    n_eff = effective_returns(r, 2.5, K_DEPTH)
    assert n_eff < pixels / 4, f"{n_eff:.1f} independent returns in {pixels} pixels"
    # ADR-020's figure for a 14 cm torso patch at 2.5 m.
    assert n_eff == pytest.approx(2.94, rel=0.35)


def test_return_density_rises_as_the_subject_comes_closer():
    """ADR-020's Consequences: density scales as 1/Z^2, so capture distance is a
    tuning parameter with real consequences for the twist floor."""
    r_far = patch_radius_px(TORSO_PATCH_RADIUS_M, 2.5, K_DEPTH)
    r_near = patch_radius_px(TORSO_PATCH_RADIUS_M, 1.7, K_DEPTH)
    assert effective_returns(r_near, 1.7, K_DEPTH) > effective_returns(r_far, 2.5, K_DEPTH)


# --- sampling: the happy path ----------------------------------------------


def test_a_flat_surface_recovers_its_depth_and_reports_its_evidence():
    s = sample_landmark_depth(
        flat_scene(2.5),
        u=539.5,
        v=719.5,
        k_video=K_VIDEO,
        k_depth=K_DEPTH,
        mask=full_mask(),
        expected_depth_m=2.5,
    )
    assert s is not None
    assert s.depth_m == pytest.approx(2.5, abs=1e-9)
    assert s.mad_m == pytest.approx(0.0, abs=1e-12)
    assert s.pixels_used >= MIN_PATCH_PIXELS
    assert s.n_effective > 1.0
    # Only the random component shrinks with independent returns, and the
    # reported sigma is that of a patch MEDIAN - so it carries the
    # median-efficiency factor sqrt(pi/2). Asserted against the one definition
    # in `uncertainty3d` rather than re-derived here, because two copies of this
    # formula is exactly how one of them ends up 25% optimistic.
    assert s.sigma_m == pytest.approx(depth_sigma_from_returns(s.n_effective), rel=1e-12)
    assert s.sigma_m == pytest.approx(POINT_SIGMA_M * np.sqrt(np.pi / 2) / np.sqrt(s.n_effective), rel=1e-9)
    assert s.sigma_m < POINT_SIGMA_M


def test_the_reported_sigma_never_claims_more_than_the_returns_support():
    """Dividing by the PIXEL count rather than the return count would be the
    single most damaging possible error here, so it gets its own assertion."""
    s = sample_landmark_depth(
        flat_scene(2.5), u=539.5, v=719.5, k_video=K_VIDEO, k_depth=K_DEPTH, mask=full_mask()
    )
    assert s is not None
    pixel_based = POINT_SIGMA_M / np.sqrt(s.pixels_used)
    assert s.sigma_m > 2.0 * pixel_based


def test_sampling_works_without_a_mask_or_confidence_plane():
    """`hasConfidence` is optional in the sidecar, so a track without it is a
    real case. The MAD and body-depth gates then carry the load alone - pure
    rejection filters, biased toward discarding good readings, which is the
    correct direction for a missing input."""
    s = sample_landmark_depth(flat_scene(2.5), u=539.5, v=719.5, k_video=K_VIDEO, k_depth=K_DEPTH)
    assert s is not None and s.depth_m == pytest.approx(2.5, abs=1e-9)


def test_medium_confidence_is_accepted():
    """`.high` alone is sparse at 2.5 m on dark or matte clothing; demanding it
    would reject most of a real clinic capture."""
    conf = np.full((192, 256), MIN_CONFIDENCE, dtype=np.uint8)
    s = sample_landmark_depth(
        flat_scene(2.5), u=539.5, v=719.5, k_video=K_VIDEO, k_depth=K_DEPTH, confidence=conf
    )
    assert s is not None


# --- sampling: every refusal -----------------------------------------------


def test_an_all_nan_patch_returns_none():
    d = flat_scene(2.5)
    d[:] = np.nan
    assert (
        sample_landmark_depth(d, u=539.5, v=719.5, k_video=K_VIDEO, k_depth=K_DEPTH, mask=full_mask())
        is None
    )


def test_too_few_surviving_pixels_returns_none():
    d = np.full((192, 256), np.nan)
    d[95:97, 127:129] = 2.5  # 4 pixels, under MIN_PATCH_PIXELS
    assert (
        sample_landmark_depth(d, u=539.5, v=719.5, k_video=K_VIDEO, k_depth=K_DEPTH, mask=full_mask())
        is None
    )


def test_low_confidence_pixels_are_excluded_and_can_empty_the_patch():
    conf = np.zeros((192, 256), dtype=np.uint8)  # all low
    assert (
        sample_landmark_depth(
            flat_scene(2.5), u=539.5, v=719.5, k_video=K_VIDEO, k_depth=K_DEPTH, confidence=conf
        )
        is None
    )


def test_a_patch_straddling_two_surfaces_returns_none():
    """Half body at 2.5 m, half wall at 3.5 m.

    The MAD gate alone does NOT catch this, and that is worth knowing: MAD is
    robust, so the majority surface takes the median and the deviation from it
    is zero. With the patch 53% wall, `mad == 0.0` exactly and the sampler would
    have reported the WALL's distance as the shoulder's. The consensus gate is
    what rejects it, whichever surface happens to win."""
    d = flat_scene(2.5)
    d[:, 128:] = 3.5
    s = sample_landmark_depth(
        d, u=539.5, v=719.5, k_video=K_VIDEO, k_depth=K_DEPTH, mask=full_mask(), expected_depth_m=2.5
    )
    assert s is None


def test_the_mad_gate_alone_would_have_missed_a_majority_background_patch():
    """Pins the blind spot the consensus gate exists to cover, so nobody
    "simplifies" it away on the grounds that MAD already checks the spread."""
    d = flat_scene(2.5)
    d[:, 128:] = 3.5
    values = d[90:101, 123:134].ravel()  # the patch the sampler would take
    median = float(np.median(values))
    mad = float(np.median(np.abs(values - median)))
    assert mad == pytest.approx(0.0, abs=1e-12), "MAD is blind here"
    assert median == pytest.approx(3.5), "and the median sits on the WALL"
    # ...while the consensus is only just over half, which is what gets caught.
    consensus = float(np.count_nonzero(np.abs(values - median) <= MAX_PATCH_MAD_M) / values.size)
    assert 0.4 < consensus < MIN_PATCH_CONSENSUS


def test_a_minority_of_background_pixels_is_also_rejected():
    """The mirror case: the body wins the median, but a quarter of the patch is
    wall. The median is defensible, yet the sample is not trustworthy enough to
    build geometry on, so it is refused rather than reported with a wider
    sigma."""
    d = flat_scene(2.5)
    d[:, 131:] = 3.5  # ~27% of an 11-wide patch centred at 128
    s = sample_landmark_depth(
        d, u=539.5, v=719.5, k_video=K_VIDEO, k_depth=K_DEPTH, mask=full_mask(), expected_depth_m=2.5
    )
    assert s is None


def test_a_patch_with_a_small_spread_is_still_accepted():
    """The gate must not reject a real, gently curved torso. A 1 cm spread is
    well inside MAX_PATCH_MAD_M."""
    rng = np.random.default_rng(3)
    d = flat_scene(2.5) + rng.normal(scale=0.005, size=(192, 256))
    s = sample_landmark_depth(
        d, u=539.5, v=719.5, k_video=K_VIDEO, k_depth=K_DEPTH, mask=full_mask(), expected_depth_m=2.5
    )
    assert s is not None and s.mad_m < MAX_PATCH_MAD_M


def test_a_patch_entirely_on_the_background_returns_none():
    """It passes the MAD gate - the wall is flat - so the body-depth gate is what
    catches it."""
    d = flat_scene(2.5 + MAX_BODY_DEPTH_DEVIATION_M + 0.5)
    s = sample_landmark_depth(
        d,
        u=539.5,
        v=719.5,
        k_video=K_VIDEO,
        k_depth=K_DEPTH,
        mask=full_mask(),
        body_depth_m=2.5,
        expected_depth_m=2.5,
    )
    assert s is None


def test_an_eroded_away_region_returns_none_rather_than_falling_back():
    """A forearm too thin to survive erosion yields no depth. The sampler must
    not quietly reuse the un-eroded mask to find something."""
    mask = np.zeros((192, 256), dtype=bool)
    mask[94:98, :] = True  # 4 px tall; 2 px erosion leaves nothing
    assert (
        sample_landmark_depth(
            flat_scene(2.5), u=539.5, v=719.5, k_video=K_VIDEO, k_depth=K_DEPTH, mask=mask
        )
        is None
    )


@pytest.mark.parametrize("u,v", [(-400.0, 719.5), (2000.0, 719.5), (539.5, -300.0), (539.5, 3000.0)])
def test_a_landmark_outside_the_depth_map_returns_none(u, v):
    assert (
        sample_landmark_depth(flat_scene(2.5), u=u, v=v, k_video=K_VIDEO, k_depth=K_DEPTH, mask=full_mask())
        is None
    )


def test_there_is_no_unbounded_window_growth():
    """A single good region 30 cm away from the landmark must NOT be found. An
    expanding search is neighbour extrapolation: a 21x21 patch at 2.5 m spans
    about 22 cm, so a patch "centred on the shoulder" that grew that far would
    be averaging the neck and the upper arm."""
    d = np.full((192, 256), np.nan)
    d[20:40, 20:40] = 2.5  # a healthy region, far from the sampled point
    assert (
        sample_landmark_depth(d, u=539.5, v=719.5, k_video=K_VIDEO, k_depth=K_DEPTH, mask=full_mask())
        is None
    )


# --- input validation -------------------------------------------------------


@pytest.mark.parametrize(
    "kwargs",
    [
        {"mask": np.ones((10, 10), dtype=bool)},
        {"confidence": np.ones((10, 10), dtype=np.uint8)},
    ],
)
def test_a_mismatched_plane_is_an_error_not_a_silent_crop(kwargs):
    with pytest.raises(ValueError):
        sample_landmark_depth(flat_scene(2.5), u=539.5, v=719.5, k_video=K_VIDEO, k_depth=K_DEPTH, **kwargs)


def test_a_one_dimensional_depth_array_is_an_error():
    with pytest.raises(ValueError):
        sample_landmark_depth(np.zeros(100), u=0.0, v=0.0, k_video=K_VIDEO, k_depth=K_DEPTH)


def test_a_non_positive_distance_is_refused_when_sizing_a_patch():
    with pytest.raises(ValueError):
        patch_radius_px(TORSO_PATCH_RADIUS_M, 0.0, K_DEPTH)
