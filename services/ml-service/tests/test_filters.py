"""app/signal/filters.py - the Butterworth design, zero-phase filtering, the
jitter residual, and the creep slope.

scipy is not a dependency, so this design is written out by hand. The tests
therefore pin it against the properties a Butterworth MUST have, not against
scipy's numbers - a comparison that was never available. The magnitude response
is checked against its own closed form, which is independent of the
implementation that produced the coefficients.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.signal.filters import (
    DEFAULT_CUTOFF_HZ,
    DEFAULT_ORDER,
    bandpass,
    butter_lowpass,
    combine_in_quadrature,
    creep_slope,
    DEFAULT_CUTOFF_HZ,
    decompose,
    filtfilt,
    lfilter,
    lfilter_zi,
    lowpass,
)

FS = 30.0


def magnitude(b: np.ndarray, a: np.ndarray, f: float, fs: float = FS) -> float:
    """|H(f)| of the single-pass filter, straight from the transfer function."""
    z = np.exp(2j * np.pi * f / fs)
    return float(abs(np.polyval(b, z) / np.polyval(a, z)))


# --- the design ------------------------------------------------------------


def test_the_cutoff_is_exactly_minus_three_decibels():
    """The point of prewarping. Without `tan` prewarping the bilinear
    transform's frequency compression moves the digital cutoff away from the
    requested one, and the filter quietly passes more sway than asked."""
    b, a = butter_lowpass(DEFAULT_CUTOFF_HZ, FS, DEFAULT_ORDER)
    assert magnitude(b, a, DEFAULT_CUTOFF_HZ) == pytest.approx(1 / np.sqrt(2), rel=1e-6)


def test_unity_gain_at_dc_so_a_held_posture_is_not_rescaled():
    b, a = butter_lowpass(DEFAULT_CUTOFF_HZ, FS, DEFAULT_ORDER)
    assert magnitude(b, a, 0.0) == pytest.approx(1.0, abs=1e-12)


def test_the_response_is_monotonic_and_falls_at_the_butterworth_rate():
    b, a = butter_lowpass(DEFAULT_CUTOFF_HZ, FS, DEFAULT_ORDER)
    freqs = np.linspace(0.0, FS / 2, 400)
    mags = np.array([magnitude(b, a, f) for f in freqs])
    assert np.all(np.diff(mags) <= 1e-12), "a Butterworth has no ripple in either band"
    # An order-4 low-pass falls ~24 dB per octave well above the cutoff.
    octave = magnitude(b, a, 3.0) / magnitude(b, a, 6.0)
    assert 20 * np.log10(octave) == pytest.approx(24.0, abs=4.0)


@pytest.mark.parametrize("order", [1, 2, 4, 6])
def test_every_order_keeps_the_cutoff_and_dc_gain(order):
    b, a = butter_lowpass(DEFAULT_CUTOFF_HZ, FS, order)
    assert magnitude(b, a, DEFAULT_CUTOFF_HZ) == pytest.approx(1 / np.sqrt(2), rel=1e-6)
    assert magnitude(b, a, 0.0) == pytest.approx(1.0, abs=1e-12)


@pytest.mark.parametrize("cutoff,fs", [(0.0, 30.0), (15.0, 30.0), (20.0, 30.0), (1.5, 0.0)])
def test_an_impossible_cutoff_is_refused(cutoff, fs):
    with pytest.raises(ValueError):
        butter_lowpass(cutoff, fs)


# --- zero phase -------------------------------------------------------------


def test_a_constant_passes_through_untouched():
    """The test that caught the real bug here. With `lfilter` starting from zero
    state, a constant 5.0 came out deviating by **0.56** - the filter charging
    up - and the padding could not absorb it for an 8th-order effective
    response. `lfilter_zi` starts each pass already settled on its own first
    sample."""
    b, a = butter_lowpass(DEFAULT_CUTOFF_HZ, FS, DEFAULT_ORDER)
    out = filtfilt(b, a, np.full(600, 5.0))
    assert np.max(np.abs(out - 5.0)) < 1e-9


def test_a_linear_trend_passes_through_with_its_slope_intact():
    """A trend is DC-plus-ramp, all below the cutoff. If the filter bent it, the
    creep slope below would be measuring the filter."""
    b, a = butter_lowpass(DEFAULT_CUTOFF_HZ, FS, DEFAULT_ORDER)
    t = np.arange(600) / FS
    out = filtfilt(b, a, 0.5 * t)
    assert np.polyfit(t, out, 1)[0] == pytest.approx(0.5, rel=1e-4)


def test_the_filter_has_exactly_zero_phase():
    """A symmetric input stays symmetric. Zero phase matters because the output
    is compared against landmark positions at the SAME timestamps; a causal
    filter's lag would shift the smoothed trace against its own frame times,
    which is a different measurement rather than a slightly worse one."""
    b, a = butter_lowpass(DEFAULT_CUTOFF_HZ, FS, DEFAULT_ORDER)
    n = 601
    t = np.arange(n) / FS
    pulse = np.exp(-((t - t[n // 2]) ** 2) / 0.5)
    out = filtfilt(b, a, pulse)
    assert np.max(np.abs(out - out[::-1])) < 1e-9


def test_a_causal_pass_does_lag_which_is_why_filtfilt_exists():
    """States the thing being avoided, so the two-pass cost is justified in the
    suite rather than only in a comment."""
    b, a = butter_lowpass(DEFAULT_CUTOFF_HZ, FS, DEFAULT_ORDER)
    n = 601
    t = np.arange(n) / FS
    pulse = np.exp(-((t - t[n // 2]) ** 2) / 0.5)
    causal = lfilter(b, a, pulse, lfilter_zi(b, a) * pulse[0])
    assert int(np.argmax(causal)) > n // 2 + 2, "a causal pass must lag"
    assert int(np.argmax(filtfilt(b, a, pulse))) == pytest.approx(n // 2, abs=1)


def test_the_interior_attenuation_matches_the_closed_form_squared():
    """`filtfilt` applies the filter twice, so the interior response is |H|^2.

    Measured in the INTERIOR on purpose. Odd-reflection padding necessarily
    injects broadband energy at the two ends - mirroring a sine about its
    endpoint creates a kink in the derivative - so a whole-series amplitude
    ratio reads a floor of about 0.08 at 10 Hz that is edge artifact, not
    passband leakage. scipy's filtfilt behaves the same way. Worth knowing
    before trusting a stopband figure measured across a short window."""
    b, a = butter_lowpass(DEFAULT_CUTOFF_HZ, FS, DEFAULT_ORDER)
    n = 600
    t = np.arange(n) / FS
    interior = slice(90, n - 90)
    for f in (3.0, 5.0):
        x = np.sin(2 * np.pi * f * t)
        y = lowpass(x, FS)
        ratio = float(y[interior].std() / x[interior].std())
        assert ratio == pytest.approx(magnitude(b, a, f) ** 2, rel=0.05)


def test_sway_in_the_passband_survives():
    t = np.arange(600) / FS
    for f in (0.1, 0.25, 0.5):
        x = np.sin(2 * np.pi * f * t)
        assert lowpass(x, FS).std() / x.std() == pytest.approx(1.0, abs=0.02)


def test_a_series_too_short_to_pad_is_refused_rather_than_mangled():
    """Returning it with the transient eating both ends would look like data."""
    b, a = butter_lowpass(DEFAULT_CUTOFF_HZ, FS, DEFAULT_ORDER)
    with pytest.raises(ValueError, match="too short"):
        filtfilt(b, a, np.zeros(10))


# --- the residual, and what it must never be used for -----------------------


def test_the_residual_captures_jitter_and_leaves_the_slow_part_alone():
    rng = np.random.default_rng(4)
    t = np.arange(900) / FS
    slow = 2.0 * np.sin(2 * np.pi * 0.2 * t)
    jitter = rng.normal(scale=0.5, size=t.size)
    d = decompose(slow + jitter, FS)

    assert d.low.std() == pytest.approx(slow.std(), rel=0.05)
    assert d.jitter_sigma == pytest.approx(0.5, rel=0.15)


def test_the_residual_cannot_see_a_static_offset_at_all():
    """THE reason it must not replace the declared sigma.

    A constant bias - the landmark-to-bony-landmark offset, soft tissue,
    clothing, the pose model's left/right asymmetry - is entirely in `low` and
    entirely absent from `residual`. These terms dominate the real uncertainty
    and are invisible to any low-pass usable over a 10-second hold."""
    rng = np.random.default_rng(9)
    t = np.arange(900) / FS
    jitter = rng.normal(scale=0.5, size=t.size)

    without = decompose(jitter, FS).jitter_sigma
    with_bias = decompose(jitter + 7.0, FS).jitter_sigma
    assert with_bias == pytest.approx(without, rel=1e-6), "a 7-unit bias changed nothing"


def test_substituting_the_residual_would_understate_sigma_about_twofold():
    """Quantifies ADR-020 section 6 against the noise model the rest of the
    suite is calibrated on: 80% of the in-plane variance is static within a
    clip, so the residual sees only the remaining 20%."""
    rng = np.random.default_rng(11)
    t = np.arange(900) / FS
    total_sigma = 14.3
    static = rng.normal(scale=total_sigma * np.sqrt(0.8))  # one draw per clip
    jitter = rng.normal(scale=total_sigma * np.sqrt(0.2), size=t.size)

    measured = decompose(static + jitter, FS).jitter_sigma
    assert total_sigma / measured == pytest.approx(2.24, rel=0.2)


def test_quadrature_keeps_the_declared_term_whole():
    """The only route this module offers. `max()` or a substitution would both
    discard the part of the error that dominates."""
    assert combine_in_quadrature(12.79, 6.40) == pytest.approx(14.30, rel=0.01)
    # Strictly larger than either input: jitter is an addition, not a verdict.
    assert combine_in_quadrature(10.0, 3.0) > 10.0
    assert combine_in_quadrature(10.0, 0.0) == pytest.approx(10.0)


def test_quadrature_refuses_a_negative_sigma():
    with pytest.raises(ValueError):
        combine_in_quadrature(-1.0, 1.0)


# --- creep ------------------------------------------------------------------


def test_a_real_drift_is_recovered_with_its_direction():
    t = np.arange(300) / FS  # 10 s
    fit = creep_slope(0.4 * t + 2.0, FS)
    assert fit.slope_per_second == pytest.approx(0.4, rel=0.02)
    assert fit.total_change == pytest.approx(0.4 * 10.0, rel=0.03)
    assert fit.is_significant


def test_a_negative_drift_keeps_its_sign():
    t = np.arange(300) / FS
    assert creep_slope(-0.3 * t, FS).slope_per_second == pytest.approx(-0.3, rel=0.02)


def test_pure_sway_is_not_reported_as_a_drift():
    """Zero-mean oscillation is not fatigue. Over the two or three cycles a
    10-second hold contains, sway does not average out, so a single slow
    oscillation can masquerade as a trend - which is why the slope is fitted to
    the low-passed trace and tested against its own standard error."""
    t = np.arange(300) / FS
    fit = creep_slope(3.0 * np.sin(2 * np.pi * 0.25 * t), FS)
    assert abs(fit.total_change) < 1.5
    assert not fit.is_significant


def test_drift_is_separated_from_sway_riding_on_top_of_it():
    t = np.arange(600) / FS
    fit = creep_slope(0.25 * t + 2.0 * np.sin(2 * np.pi * 0.3 * t), FS)
    assert fit.slope_per_second == pytest.approx(0.25, abs=0.08)
    assert fit.is_significant


def test_noise_alone_rarely_clears_the_significance_threshold():
    """The test that caught a 60% false-positive rate.

    With an uncorrected OLS standard error, **24 of 40** pure-noise clips
    reported a significant postural drift - a quantity a clinician could read as
    fatigue. Two fixes, both measured: the standard error is corrected for the
    autocorrelation the low-pass leaves (`n_eff ~ n * 2 fc / fs`, about a tenth
    of the samples here), and the threshold is 3 sigma rather than 2.
    """
    flagged = sum(
        creep_slope(np.random.default_rng(seed).normal(scale=1.0, size=400), FS).is_significant
        for seed in range(200)
    )
    assert flagged <= 10, f"{flagged}/200 noise-only clips reported a drift"


def test_the_autocorrelation_correction_is_what_makes_that_work():
    """Pins the correction itself, so removing it fails here with a reason
    rather than only showing up as a worse false-positive rate."""
    rng = np.random.default_rng(3)
    series = rng.normal(scale=1.0, size=400)
    fit = creep_slope(series, FS)

    low = lowpass(series, FS)
    t = np.arange(low.size) / FS
    slope, intercept = np.polyfit(t, low, 1)
    resid = low - (slope * t + intercept)
    ols = float(np.sqrt((resid @ resid) / (low.size - 2) / ((t - t.mean()) ** 2).sum()))

    # ~sqrt(fs / (2 fc)) = sqrt(10) larger than the naive figure.
    assert fit.slope_stderr / ols == pytest.approx(np.sqrt(FS / (2 * DEFAULT_CUTOFF_HZ)), rel=0.01)


def test_a_true_drift_still_clears_the_stricter_threshold():
    """The stricter threshold has to cost nothing, or it has just traded one
    error for the other."""
    detected = sum(
        creep_slope(
            0.1 * np.arange(400) / FS + np.random.default_rng(900 + seed).normal(size=400), FS
        ).is_significant
        for seed in range(50)
    )
    assert detected == 50


def test_the_slope_standard_error_is_reported_so_a_caller_can_judge_it():
    t = np.arange(300) / FS
    assert creep_slope(0.4 * t, FS).slope_stderr >= 0.0


# --- band-pass --------------------------------------------------------------


def test_the_bandpass_keeps_its_band_and_rejects_either_side():
    t = np.arange(1200) / FS  # 40 s, several respiratory cycles
    interior = slice(150, 1200 - 150)
    for f, keep in ((0.02, False), (0.25, True), (1.5, False), (5.0, False)):
        x = np.sin(2 * np.pi * f * t)
        ratio = float(bandpass(x, FS, 0.15, 0.5)[interior].std() / x[interior].std())
        if keep:
            assert ratio > 0.5, f"{f} Hz should pass, got {ratio:.3f}"
        else:
            assert ratio < 0.3, f"{f} Hz should be rejected, got {ratio:.3f}"


def test_the_bandpass_removes_a_constant_and_a_slow_trend():
    t = np.arange(1200) / FS
    out = bandpass(100.0 + 0.5 * t, FS, 0.15, 0.5)
    assert np.max(np.abs(out[150:-150])) < 0.2


@pytest.mark.parametrize("low,high", [(0.5, 0.15), (0.0, 0.5), (0.15, 20.0)])
def test_an_impossible_band_is_refused(low, high):
    with pytest.raises(ValueError):
        bandpass(np.zeros(1200), FS, low, high)
