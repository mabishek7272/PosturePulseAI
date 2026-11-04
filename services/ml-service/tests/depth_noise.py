"""Spatially correlated LiDAR depth noise, plus in-plane landmark noise.

THIS FIXTURE DECIDES WHETHER THE PHASE 2 TEST SUITE IS HONEST. Everything else
in the suite measures the pipeline against it, so if it generates noise that is
easier to average away than the sensor's, the suite will certify an uncertainty
model that is confidently wrong. Three ways to get that wrong, all avoided here:

**1. i.i.d. per-pixel noise.** The depth sampler takes a median over an 11x11
patch. Over 121 independent samples a median shrinks sigma by roughly
`sqrt(121) = 11`, so an i.i.d. fixture would let the pipeline report an
uncertainty about an order of magnitude below the truth and still pass. Real
LiDAR error is correlated over roughly the 8.2 cm spacing between independent
returns (ADR-020 section 4: ~150 real returns per m^2 at 2.5 m, upsampled to a
256x192 map), so a patch that size contains only a handful of independent
samples and the median barely attenuates. `test_depth_noise.py` measures that
ratio and asserts it, so the property cannot quietly regress.

**2. An optimistic per-point sigma.** `POINT_SIGMA_M` is 0.020, the published
per-point precision ADR-020's whole error budget is derived from. A smaller
value (8 mm was proposed) propagates straight into every downstream sigma. It is
the same class of error as substituting a low-pass filter residual for the
position sigma, which ADR-020 section 6 rejects: the instrument ends up claiming
precision it does not have.

**3. Letting the component weights decide the total.** Splitting sigma into a
correlated part at `0.85 * sigma` and a readout part at `0.15 * sigma` and adding
the two fields gives a total of `hypot(0.85, 0.15) = 0.863 * sigma`, not
`sigma`. Bilinear upsampling of a lattice field then removes more: interpolated
values between lattice nodes are weighted averages of them, so the field's
pointwise variance falls further, to about `0.59 * sigma` for an 8.37-pixel
lattice. Those two compound with an optimistic base into roughly a 4x
underestimate. Here the correlated component is normalised to unit variance by a
measured gain before it is scaled, and the two components are combined in
quadrature, so the field's realised pointwise sigma IS the requested one -
asserted by `test_the_field_realises_the_sigma_it_was_asked_for`.

The noise is additive in metres and is applied to true depth; it is never used
to clamp, repair or fill a value.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np

# Per-point depth precision, metres (ADR-020 section 4). The number the error
# budget is built on; do not lower it to make a test pass.
POINT_SIGMA_M = 0.020

# Distance between independent LiDAR returns AT THE REFERENCE DISTANCE, metres.
# From ~150 real returns per m^2: mean spacing `1 / sqrt(150)` = 0.082 m.
#
# This is a reference value, NOT a constant of the sensor. The LiDAR emits a
# fixed ANGULAR pattern of about 576 spots, so their spacing on a surface scales
# with distance - 5.6 cm at 1.7 m, 9.8 cm at 3.0 m - while their spacing in
# PIXELS stays put at about 7.8 px. `correlated_depth_noise_m` therefore takes a
# distance and scales this, rather than taking a correlation length in metres.
#
# Holding it fixed in metres was a real bug here, and the cross-check against
# `POINT_SIGMA_M / sqrt(n_effective)` is what caught it: it made the lattice
# 11.4 px at 1.7 m instead of 7.8, so the field had too few independent samples
# per patch and the empirical sigma came out FLAT with distance (11.8, 11.5,
# 11.0 mm at 1.7, 2.5, 3.0 m) when it should fall as the subject comes closer.
# The analytical model understated by 1.6x at 1.7 m against that field, and
# without the cross-check the natural conclusion would have been that the MODEL
# was wrong.
CORRELATION_LENGTH_M = 0.082
REFERENCE_DISTANCE_M = 2.5

# Fraction of the depth variance that is spatially correlated. The rest is
# per-pixel readout noise. Correlated error dominates because the map is
# upsampled from far fewer real returns than it has pixels, so neighbouring
# pixels frequently derive from the same return.
CORRELATED_VARIANCE_FRACTION = 0.85

# In-plane landmark sigma as a fraction of body height in pixels. Matches
# `POSITION_SD_FRACTION` in app/metrics/static_metrics.py, deliberately: the
# fixture must exercise the same uncertainty the pipeline reports, or the
# calibration test compares two unrelated numbers.
POSITION_SD_FRACTION = 0.01

# How much of the in-plane error is static within a clip. The landmark-to-bony-
# landmark offset, soft-tissue and clothing offset, and the pose model's
# left/right joint-centre asymmetry do not change while someone holds still, so
# they do NOT average down over frames - which is why
# `static_metrics.aggregate` refuses to divide sigma by sqrt(N), and why a
# fixture whose landmark error was pure per-frame jitter would make that refusal
# look like excessive caution.
STATIC_VARIANCE_FRACTION = 0.8


def pixel_pitch_m(fx_depth_px: float, distance_m: float) -> float:
    """Metres per depth pixel at `distance_m`, from the depth map's own `fx`.

    Derived from the intrinsics the code under test uses rather than hardcoded,
    so the fixture and the pipeline cannot disagree about the geometry. At
    fx_depth = 237 px (a 1000 px video fx rescaled from 1080 to 256 wide) and
    2.5 m this is 10.6 mm, not the 9.8 mm a round-number FOV assumption gives.
    """
    if fx_depth_px <= 0 or distance_m <= 0:
        raise ValueError("fx and distance must be positive")
    return distance_m / fx_depth_px


def _bilinear_upsample(a: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """Bilinear resize of `a` to `shape`. Replaces `scipy.ndimage.zoom`.

    scipy is not a dependency of this service (only mediapipe and numpy), and
    adding one for a test fixture is a supply-chain decision, not a convenience.
    This is the same order-1 interpolation on the same corner-aligned grid.
    """
    out_h, out_w = shape
    in_h, in_w = a.shape
    yi = np.linspace(0.0, in_h - 1, out_h)
    xi = np.linspace(0.0, in_w - 1, out_w)
    y0 = np.floor(yi).astype(int)
    x0 = np.floor(xi).astype(int)
    y1 = np.minimum(y0 + 1, in_h - 1)
    x1 = np.minimum(x0 + 1, in_w - 1)
    wy = (yi - y0)[:, None]
    wx = (xi - x0)[None, :]
    return (
        a[np.ix_(y0, x0)] * (1 - wy) * (1 - wx)
        + a[np.ix_(y1, x0)] * wy * (1 - wx)
        + a[np.ix_(y0, x1)] * (1 - wy) * wx
        + a[np.ix_(y1, x1)] * wy * wx
    )


def _lattice_shape(shape: tuple[int, int], lattice_px: float) -> tuple[int, int]:
    return (
        max(2, int(np.ceil(shape[0] / lattice_px)) + 1),
        max(2, int(np.ceil(shape[1] / lattice_px)) + 1),
    )


@lru_cache(maxsize=32)
def _unit_variance_gain(shape: tuple[int, int], lattice_px: float) -> float:
    """Gain that makes the upsampled lattice field have unit pointwise variance.

    MEASURED, not assumed. Bilinear upsampling reduces variance by a factor that
    depends on the lattice spacing and the output grid, and getting it wrong is
    one of the three ways listed in the module docstring to end up with an
    optimistic suite. Measuring it once (deterministically seeded, cached) is
    both exact for the parameters in use and robust to changing them.
    """
    rng = np.random.default_rng(0xC0FFEE)
    coarse_shape = _lattice_shape(shape, lattice_px)
    total = 0.0
    draws = 64
    for _ in range(draws):
        field = _bilinear_upsample(rng.normal(size=coarse_shape), shape)
        total += float(np.var(field))
    mean_var = total / draws
    if mean_var <= 0:
        raise AssertionError("degenerate lattice field")
    return float(1.0 / np.sqrt(mean_var))


def lattice_spacing_px(fx_depth_px: float) -> float:
    """Spacing between independent LiDAR returns, in DEPTH PIXELS.

    Constant with distance, because the spot pattern is fixed in angle: both the
    pixel pitch and the return spacing scale with Z, so their ratio does not.
    Deriving it this way makes the distance-dependence bug above unrepresentable.
    """
    if fx_depth_px <= 0:
        raise ValueError("fx must be positive")
    return CORRELATION_LENGTH_M * fx_depth_px / REFERENCE_DISTANCE_M


def correlated_depth_noise_m(
    shape: tuple[int, int],
    *,
    rng: np.random.Generator,
    fx_depth_px: float,
    sigma_m: float = POINT_SIGMA_M,
) -> np.ndarray:
    """An additive depth-error field in metres, with the sensor's correlation.

    Takes the depth map's `fx` rather than a pitch and a correlation length,
    because those two must be consistent with each other and with the distance -
    and when they were separate arguments they were not (see
    `CORRELATION_LENGTH_M`). The lattice is fixed in pixels, so no distance is
    needed at all.

    `rng` is required and has no default: a default seed makes it far too easy
    to run a thousand "realisations" that are all the same field, which turns a
    Monte-Carlo test into one sample with a thousand-fold false confidence.
    """
    if sigma_m < 0:
        raise ValueError("sigma_m must not be negative")
    if sigma_m == 0:
        return np.zeros(shape)

    lattice_px = lattice_spacing_px(fx_depth_px)
    if lattice_px <= 1.0:
        # Return spacing shorter than a pixel: the field is effectively
        # independent per pixel. Said out loud rather than silently producing a
        # degenerate lattice, because it means the premise of this fixture does
        # not hold for the geometry it was handed.
        raise ValueError(
            f"return spacing is {lattice_px:.2f} px, under one pixel; "
            "the correlated-noise model does not apply"
        )

    coarse = rng.normal(size=_lattice_shape(shape, lattice_px))
    gain = _unit_variance_gain(shape, lattice_px)
    correlated = _bilinear_upsample(coarse, shape) * gain

    # Quadrature, so the two components sum to `sigma_m` rather than to
    # `hypot(w, 1 - w) * sigma_m`.
    w_corr = float(np.sqrt(CORRELATED_VARIANCE_FRACTION))
    w_read = float(np.sqrt(1.0 - CORRELATED_VARIANCE_FRACTION))
    readout = rng.normal(size=shape)
    return sigma_m * (w_corr * correlated + w_read * readout)


def landmark_noise_px(
    n_frames: int,
    n_landmarks: int,
    *,
    rng: np.random.Generator,
    body_height_px: float,
    sigma_fraction: float = POSITION_SD_FRACTION,
    static_fraction: float = STATIC_VARIANCE_FRACTION,
) -> np.ndarray:
    """`(n_frames, n_landmarks, 2)` of in-plane landmark error, in pixels.

    Present because **in-plane error is the dominant term**, not depth: at
    Z = 2.5 m with fx = 1000 and a 1430 px body, in-plane sigma is 0.0358 m
    against depth random sigma of 0.0117 m - about 3x larger (ADR-020
    section 5). A fixture that perturbs depth alone would validate the
    uncertainty model against the smaller of the two error sources.

    Most of the variance is STATIC across the clip, so it does not average down
    over frames. That is the property that makes `static_metrics.aggregate`'s
    refusal to divide by sqrt(N) correct rather than conservative.
    """
    sigma = sigma_fraction * body_height_px
    static = rng.normal(scale=sigma * np.sqrt(static_fraction), size=(1, n_landmarks, 2))
    jitter = rng.normal(scale=sigma * np.sqrt(1.0 - static_fraction), size=(n_frames, n_landmarks, 2))
    return static + jitter
