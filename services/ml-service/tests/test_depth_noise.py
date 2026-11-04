"""tests/depth_noise.py - the fixture the rest of the Phase 2 suite rests on.

A fixture usually needs no tests of its own. This one does, because every later
assertion about reported uncertainty is only as honest as this field's
statistics, and the failure mode is silent: an over-optimistic noise field makes
an over-confident uncertainty model pass.
"""
from __future__ import annotations

import numpy as np
import pytest

from depth_noise import (
    CORRELATION_LENGTH_M,
    POINT_SIGMA_M,
    REFERENCE_DISTANCE_M,
    correlated_depth_noise_m,
    landmark_noise_px,
    lattice_spacing_px,
    pixel_pitch_m,
)

SHAPE = (192, 256)
#: Depth-map fx for a 1000 px video fx rescaled from 1080 to 256 wide.
FX_DEPTH = 1000.0 * 256.0 / 1080.0


def field(seed: int, **kw) -> np.ndarray:
    return correlated_depth_noise_m(SHAPE, rng=np.random.default_rng(seed), fx_depth_px=FX_DEPTH, **kw)


# --- the field realises what it promises ------------------------------------


def test_the_field_realises_the_sigma_it_was_asked_for():
    """The arithmetic check. Weighting components `0.85` and `0.15` and adding
    the fields gives `hypot(0.85, 0.15) = 0.863` of the intended sigma, and
    bilinear upsampling of a lattice field removes more again - together about
    0.59. Both are corrected here, so the realised pointwise sigma must match
    the request, not merely be of the right order."""
    sds = [float(np.std(field(s))) for s in range(24)]
    assert np.mean(sds) == pytest.approx(POINT_SIGMA_M, rel=0.03)


def test_the_per_point_sigma_is_the_published_hardware_figure():
    """Pins the constant itself. ADR-020's entire error budget - the 1.8 deg
    torso normal, the 4.2 deg twist floor, the 0.0117 m depth random term - is
    derived from 0.020 m. Lowering it here would silently relax every
    uncertainty the suite checks."""
    assert POINT_SIGMA_M == 0.020
    assert CORRELATION_LENGTH_M == pytest.approx(1.0 / np.sqrt(150.0), rel=0.02)


def test_zero_sigma_gives_an_exactly_noise_free_field():
    """Noise-free fixtures are how the geometry's closed-form tolerances are
    checked, so zero must mean zero rather than something very small."""
    assert np.all(field(1, sigma_m=0.0) == 0.0)


# --- the property that makes the suite honest -------------------------------


@pytest.mark.parametrize("patch", [9, 11, 15, 21])
def test_a_patch_median_does_not_average_the_noise_away(patch):
    """THE honesty test.

    A median over `patch**2` i.i.d. samples shrinks sigma by about
    `sqrt(patch**2)`; over this field it barely shrinks at all, because an 11 px
    patch at 10.6 mm per pixel spans about 1.4 correlation lengths and therefore
    holds only a couple of independent samples.

    If someone replaces the fixture with i.i.d. noise, the `>= 0.25` bound below
    fails immediately - which is the point. It is a lower bound, not a two-sided
    window, because the exact attenuation depends on the lattice geometry; what
    must never happen is attenuation anywhere near the i.i.d. figure."""
    c = (SHAPE[0] // 2, SHAPE[1] // 2)
    half = patch // 2
    meds = []
    iid_meds = []
    for s in range(300):
        f = field(1000 + s)
        meds.append(float(np.median(f[c[0] - half : c[0] + half + 1, c[1] - half : c[1] + half + 1])))
        iid = np.random.default_rng(9000 + s).normal(scale=POINT_SIGMA_M, size=(patch, patch))
        iid_meds.append(float(np.median(iid)))

    correlated_sd = float(np.std(meds))
    iid_sd = float(np.std(iid_meds))

    assert correlated_sd >= 0.25 * POINT_SIGMA_M, (
        f"a {patch}x{patch} median left only {correlated_sd / POINT_SIGMA_M:.3f} of sigma; "
        "this fixture has lost its spatial correlation and the suite is no longer honest"
    )
    # And it must be far worse at averaging than i.i.d. noise would be.
    assert correlated_sd > 3.0 * iid_sd


def test_the_iid_alternative_would_have_been_wildly_optimistic():
    """States the number the fixture exists to avoid, so the reason is recorded
    in the suite rather than only in a commit message."""
    patch = 11
    iid_sd = float(
        np.std(
            [
                float(np.median(np.random.default_rng(s).normal(scale=POINT_SIGMA_M, size=(patch, patch))))
                for s in range(300)
            ]
        )
    )
    assert iid_sd < 0.15 * POINT_SIGMA_M  # ~1/sqrt(121) = 0.09
    correlated_sd = float(
        np.std(
            [
                float(np.median(field(2000 + s)[91:102, 123:134]))
                for s in range(300)
            ]
        )
    )
    ratio = correlated_sd / iid_sd
    assert ratio > 3.0, f"correlated noise should resist the median far better than i.i.d.; got {ratio:.1f}x"


# --- the correlation is real and has the right length -----------------------


def test_nearby_pixels_are_correlated_and_distant_ones_are_not():
    """Measured directly, rather than inferred from the median behaviour, so a
    fixture that happened to resist the median for some other reason could not
    pass by accident."""
    lattice_px = lattice_spacing_px(FX_DEPTH)  # ~7.8 px
    near = int(round(lattice_px / 3))
    far = int(round(lattice_px * 4))

    def corr_at(shift: int) -> float:
        vals = []
        for s in range(40):
            f = field(3000 + s)
            a = f[:, : SHAPE[1] - shift].ravel()
            b = f[:, shift:].ravel()
            vals.append(float(np.corrcoef(a, b)[0, 1]))
        return float(np.mean(vals))

    assert corr_at(near) > 0.6, "pixels well inside one correlation length must track each other"
    assert abs(corr_at(far)) < 0.25, "pixels several correlation lengths apart must be near-independent"


def test_the_field_is_zero_mean_so_it_adds_no_depth_bias():
    """A biased noise field would shift every recovered distance, which would
    look like a calibration error rather than noise."""
    means = [float(np.mean(field(s))) for s in range(32)]
    assert abs(float(np.mean(means))) < 0.1 * POINT_SIGMA_M


# --- reproducibility, and the absence of a default seed ---------------------


def test_a_seed_reproduces_a_field_exactly():
    assert np.array_equal(field(42), field(42))


def test_different_seeds_give_independent_fields():
    """A Monte-Carlo run with a fixed default seed would be one sample reported
    a thousand times. `correlated_depth_noise_m` requires `rng`, so there is no
    default to fall into; this checks that distinct seeds really do differ."""
    a, b = field(1), field(2)
    assert not np.array_equal(a, b)
    assert abs(float(np.corrcoef(a.ravel(), b.ravel())[0, 1])) < 0.1


def test_rng_is_required():
    with pytest.raises(TypeError):
        correlated_depth_noise_m(SHAPE, fx_depth_px=FX_DEPTH)  # type: ignore[call-arg]


# --- geometry derived from intrinsics, not assumed --------------------------


def test_pixel_pitch_comes_from_the_depth_intrinsics():
    """A 1000 px video fx rescaled from 1080 to 256 wide gives fx_depth = 237,
    and 2.5 / 237 = 10.6 mm per pixel - not the 9.8 mm a round-number FOV
    assumption yields. Small, but the fixture and the code under test must
    agree about the geometry or the calibration test compares two different
    cameras."""
    fx_depth = 1000.0 * 256.0 / 1080.0
    assert pixel_pitch_m(fx_depth, 2.5) == pytest.approx(0.01055, rel=0.01)
    # The pitch grows linearly with distance. Asserted as a RATIO rather than
    # against the rounded constant above, which is only good to 3 figures and
    # cannot carry a 1e-6 tolerance.
    assert pixel_pitch_m(fx_depth, 1.7) / pixel_pitch_m(fx_depth, 2.5) == pytest.approx(1.7 / 2.5, rel=1e-12)


@pytest.mark.parametrize("bad", [(0.0, 2.5), (237.0, 0.0), (-1.0, 2.5)])
def test_a_degenerate_camera_or_distance_is_refused(bad):
    with pytest.raises(ValueError):
        pixel_pitch_m(*bad)


def test_a_return_spacing_shorter_than_a_pixel_is_refused_not_approximated():
    """The model's premise does not hold there, and silently producing a
    degenerate lattice would look like working code."""
    with pytest.raises(ValueError, match="under one pixel"):
        correlated_depth_noise_m(SHAPE, rng=np.random.default_rng(0), fx_depth_px=10.0)


def test_the_return_lattice_is_fixed_in_pixels_not_in_metres():
    """The LiDAR emits a fixed ANGULAR pattern, so the spot spacing in PIXELS is
    the same at every distance while the spacing in METRES scales with Z.

    Holding the correlation length fixed in metres was a real bug in this
    fixture: it made the lattice 11.4 px at 1.7 m instead of 7.8, so a patch
    held too few independent samples and the empirical spread came out flat with
    distance instead of falling as the subject approached. Deriving the lattice
    from fx alone makes that unrepresentable, and this test says why."""
    spacing = lattice_spacing_px(FX_DEPTH)
    assert spacing == pytest.approx(7.77, rel=0.02)
    # Independent of distance by construction: fx does not depend on Z.
    for distance in (1.7, 2.5, 3.0):
        assert CORRELATION_LENGTH_M * distance / REFERENCE_DISTANCE_M / pixel_pitch_m(
            FX_DEPTH, distance
        ) == pytest.approx(spacing, rel=1e-9)


# --- in-plane landmark noise, the dominant term -----------------------------


def test_in_plane_noise_matches_the_pipelines_own_sigma():
    """The fixture must exercise the same uncertainty the pipeline reports
    (`POSITION_SD_FRACTION`), or the calibration test checks one number against
    an unrelated one."""
    n = landmark_noise_px(30, 33, rng=np.random.default_rng(5), body_height_px=1430.0)
    assert n.shape == (30, 33, 2)
    # Pooled over many realisations, since one clip's static offset is a single
    # draw and its spread says nothing on its own.
    sds = []
    for s in range(200):
        one = landmark_noise_px(30, 33, rng=np.random.default_rng(s), body_height_px=1430.0)
        sds.append(float(one[:, 0, 0].mean()))
    assert float(np.std(sds)) == pytest.approx(0.01 * 1430.0 * np.sqrt(0.8), rel=0.15)


def test_in_plane_error_is_larger_than_depth_error():
    """ADR-020 section 5, as a test: the 3D error ellipsoid is an oblate pancake,
    not a needle along the viewing ray. This is why coronal tilts gain no
    precision from being recomputed in 3D."""
    sigma_in_plane_m = 0.01 * 1430.0 * 2.5 / 1000.0
    assert sigma_in_plane_m == pytest.approx(0.0358, rel=0.02)
    assert sigma_in_plane_m > 2.5 * (POINT_SIGMA_M / np.sqrt(2.94))


def test_most_in_plane_error_is_static_within_a_clip():
    """So it does NOT average down over frames. `static_metrics.aggregate`
    already refuses to divide sigma by sqrt(N) for this reason; a fixture whose
    landmark error was pure per-frame jitter would make that refusal look like
    needless caution."""
    expected_jitter = 0.01 * 1430.0 * np.sqrt(0.2)
    expected_static = 0.01 * 1430.0 * np.sqrt(0.8)

    # WITHIN one clip, only the jitter term varies.
    one = landmark_noise_px(400, 1, rng=np.random.default_rng(11), body_height_px=1430.0)
    assert float(np.std(one[:, 0, 0])) == pytest.approx(expected_jitter, rel=0.15)

    # ACROSS clips, the spread of the clip MEANS is the static term, undiminished
    # by the 400 frames averaged into each one. Measured across realisations
    # rather than from a single clip's mean: the static offset is one Gaussian
    # draw, so any one clip's can land near zero and an assertion about its size
    # would be an assertion about a seed.
    clip_means = [
        float(np.mean(landmark_noise_px(400, 1, rng=np.random.default_rng(s), body_height_px=1430.0)[:, 0, 0]))
        for s in range(300)
    ]
    assert float(np.std(clip_means)) == pytest.approx(expected_static, rel=0.15)
    # Averaging 400 frames would have cut a purely-jittery error by 20x; it
    # leaves the static term entirely intact, which is the point.
    assert float(np.std(clip_means)) > 5.0 * (expected_jitter / np.sqrt(400))
