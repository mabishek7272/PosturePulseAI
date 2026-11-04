"""app/signal/respiration.py - respiratory phase from the depth trace.

The theme of this file is the gap between what the signal supports and what it
does not. Phase is recoverable at this sensor's precision; the amplitude ratio is
not, and the tests say so with numbers rather than leaving it to a comment.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.signal.respiration import (
    DEFAULT_HALF_WIDTH_S,
    MIN_BAND_AMPLITUDE_M,
    MIN_CYCLES_FOR_RATE,
    MIN_PERIODICITY,
    RESP_HIGH_HZ,
    RESP_LOW_HZ,
    end_exhalation_windows,
    respiration_trace,
    thoracoabdominal_ratio,
)

FS = 30.0
#: Patch-median depth sigma at 2.5 m, from app/geometry/uncertainty3d.py.
DEPTH_SIGMA_M = 0.0129
#: Thoracic excursion at the sternum, metres.
EXCURSION_M = 0.007


def breathing(seconds: float, rate_hz: float, *, seed: int, noise: float = DEPTH_SIGMA_M, phase: float = 0.0) -> np.ndarray:
    n = int(FS * seconds)
    t = np.arange(n) / FS
    rng = np.random.default_rng(seed)
    return 2.5 + EXCURSION_M * np.sin(2 * np.pi * rate_hz * t + phase) + rng.normal(scale=noise, size=n)


# --- phase is recoverable, but only on a long enough window ----------------


def test_the_breathing_rate_is_recovered_on_a_long_window():
    """Raw signal-to-noise is 0.54 - the excursion is HALF the per-sample noise -
    and the rate still comes out, because a band-pass rejects most of the noise.
    40 seconds, which is where the autocorrelation can establish periodicity."""
    assert EXCURSION_M / DEPTH_SIGMA_M < 0.6, "the premise: amplitude below noise"
    trace = respiration_trace(breathing(40.0, 0.25, seed=1), FS)
    assert trace.is_periodic
    assert trace.rate_per_minute == pytest.approx(15.0, abs=1.0)


@pytest.mark.parametrize("rate_hz,expected", [(0.20, 12.0), (0.25, 15.0), (0.33, 19.8)])
def test_rates_across_the_band_are_recovered_at_forty_seconds(rate_hz, expected):
    trace = respiration_trace(breathing(40.0, rate_hz, seed=2), FS)
    assert trace.rate_per_minute == pytest.approx(expected, abs=1.0)


@pytest.mark.parametrize("seconds", [6.0, 10.0, 20.0])
def test_a_short_window_reports_nothing_rather_than_a_wrong_rate(seconds):
    """THE finding that decides the end-exhalation gate.

    A 10-second hold carries 2.5 breaths and a 6-second block 1.5. At those
    lengths the autocorrelation peak of pure noise reaches the same values as
    real breathing, so no threshold can separate them - measured, noise p95 is
    0.41 against breathing p5 of 0.12 at 10 s. The module refuses.

    Every window in the multi-block protocol (10 / 6 / 6 s) is shorter than
    this, so respiratory gating cannot be driven from any of them."""
    trace = respiration_trace(breathing(seconds, 0.25, seed=3), FS)
    assert trace.rate_per_minute is None
    assert not trace.is_periodic


def test_noise_alone_is_almost_never_called_periodic():
    """The false-positive side, across window lengths. A spurious respiratory
    rate would be a number about the patient that came from nothing."""
    for seconds in (10.0, 20.0, 40.0, 60.0):
        n = int(FS * seconds)
        flagged = sum(
            respiration_trace(
                2.5 + np.random.default_rng(seed).normal(scale=DEPTH_SIGMA_M, size=n), FS
            ).is_periodic
            for seed in range(60)
        )
        assert flagged <= 3, f"{flagged}/60 noise-only {seconds:.0f}s traces called periodic"


def test_periodicity_comes_from_the_autocorrelation_not_the_trough_gaps():
    """The trough-gap CV is NOT the discriminator, and the reason is circular:
    the minimum-spacing rule in the trough finder makes the gaps regular by
    construction. Measured, that pushed noise-only gap CV to 0.18-0.25 against
    real breathing's 0.09-0.14 - the statistic stopped separating anything. It
    is still reported for information, and `is_periodic` ignores it."""
    rng = np.random.default_rng(5)
    noise = respiration_trace(2.5 + rng.normal(scale=DEPTH_SIGMA_M, size=1200), FS)
    real = respiration_trace(breathing(40.0, 0.25, seed=5), FS)

    # Gap CV does not separate them...
    if noise.gap_cv is not None and real.gap_cv is not None:
        assert noise.gap_cv < 0.35
    # ...but the autocorrelation peak does.
    assert real.periodicity > noise.periodicity
    assert real.is_periodic and not noise.is_periodic


def test_enough_cycles_is_required_as_well_as_a_strong_peak():
    """Both conditions are necessary: the peak alone is unreliable on a short
    window, where noise reaches the same values as signal."""
    short = respiration_trace(breathing(10.0, 0.25, seed=6), FS)
    assert short.cycles_in_window < MIN_CYCLES_FOR_RATE
    long = respiration_trace(breathing(40.0, 0.25, seed=6), FS)
    assert long.cycles_in_window >= MIN_CYCLES_FOR_RATE
    assert long.periodicity >= MIN_PERIODICITY


def test_troughs_land_on_end_exhalation_which_is_the_FURTHEST_point():
    """The sign that would be invisible if wrong. End-exhalation is maximum
    ribcage deflation, so that part of the chest is at its GREATEST distance
    from the camera - a local maximum in depth. Gating on the minimum instead
    would select peak inspiration, the exact opposite of the intent, and the
    output would look entirely reasonable.

    Noise-free, so the true peaks are known. Asserted as "nearer the maximum
    than the minimum" rather than exactly at it: the trough index comes from the
    band-passed trace, whose peak can sit a few samples off the raw one, and at
    0.25 Hz the raw peak is broad enough that a few samples matter."""
    n = int(FS * 48)
    t = np.arange(n) / FS
    depth = 2.5 + EXCURSION_M * np.sin(2 * np.pi * 0.25 * t)
    trace = respiration_trace(depth, FS)
    assert trace.breaths_detected >= 8

    low, high = depth.min(), depth.max()
    midpoint = (low + high) / 2
    for index in trace.trough_indices[1:-1]:
        assert depth[index] > midpoint, "a trough must be on the far side of the breath"


def test_a_flat_trace_yields_no_breaths_rather_than_numerical_dust():
    """A constant trace band-passes to about 1e-14 m, and the maxima finder
    happily returned 19 "breaths" from it before the amplitude floor existed."""
    trace = respiration_trace(np.full(600, 2.5), FS)
    assert trace.breaths_detected == 0
    assert trace.rate_per_minute is None
    assert trace.band_amplitude < MIN_BAND_AMPLITUDE_M


def test_amplitude_cannot_separate_breathing_from_noise():
    """Why there is no amplitude threshold between them. Measured over 40-second
    traces: noise alone gives a band peak-to-peak of 9-13 mm against 16-19 mm
    for real 7 mm breathing. The ranges overlap, so a threshold placed between
    them would be unreliable in both directions."""
    n = int(FS * 40)
    noise = [
        respiration_trace(2.5 + np.random.default_rng(s).normal(scale=DEPTH_SIGMA_M, size=n), FS).band_amplitude
        for s in range(30)
    ]
    real = [respiration_trace(breathing(40.0, 0.25, seed=100 + s), FS).band_amplitude for s in range(30)]
    assert max(noise) > min(real), "if these ever separate, an amplitude gate becomes possible"


def test_the_band_rejects_sway_and_drift():
    """Postural sway at 0.8 Hz and a slow lean must not be read as breathing."""
    n = int(FS * 40)
    t = np.arange(n) / FS
    confounded = 2.5 + 0.02 * np.sin(2 * np.pi * 0.8 * t) + 0.01 * t
    trace = respiration_trace(confounded, FS)
    interior = trace.filtered[150:-150]
    assert float(np.ptp(interior)) < 0.02 * 0.6
    assert RESP_LOW_HZ < 0.25 < RESP_HIGH_HZ


def test_a_two_dimensional_input_is_refused():
    with pytest.raises(ValueError):
        respiration_trace(np.zeros((10, 10)), FS)


# --- the gate, and its cost -------------------------------------------------


def test_the_gate_keeps_only_frames_near_end_exhalation():
    n = int(FS * 40)
    trace = respiration_trace(breathing(40.0, 0.25, seed=5), FS)
    gate = end_exhalation_windows(trace, n)

    assert gate.breaths_used == trace.breaths_detected
    for start, end in gate.windows:
        assert gate.mask[start:end].all()
    # Each window is about 2 * half_width wide. `round`, not `int`: 0.25 * 30
    # is 7.5 samples, so the half-width is 8 and the window 17 wide.
    for start, end in gate.windows:
        assert end - start <= 2 * int(round(DEFAULT_HALF_WIDTH_S * FS)) + 1


def test_the_gate_discards_most_of_the_clip_and_reports_that_it_did():
    """The number that decides whether this is worth enabling.

    About 2.5 breaths in a 10-second hold, +-250 ms each, is roughly an eighth
    of the frames. `retained_fraction` is returned so a caller cannot switch
    the gate on without seeing the price."""
    n = int(FS * 40)
    trace = respiration_trace(breathing(40.0, 0.25, seed=6), FS)
    gate = end_exhalation_windows(trace, n)
    assert 0.05 < gate.retained_fraction < 0.35
    assert gate.retained_count == int(np.count_nonzero(gate.mask))


def test_the_artifact_removed_is_far_smaller_than_the_noise_it_hides_in():
    """Why the gate is OFF by default.

    Breathing lifts the shoulders by about 3 mm. In-plane landmark sigma at
    2.5 m is about 36 mm. Discarding seven frames in eight to suppress an
    artifact an order of magnitude below the noise is very unlikely to be a net
    gain - and fewer frames also makes `aggregate`'s spread term noisier and can
    trip the `insufficient_frames` gate."""
    shoulder_lift_m = 0.003
    in_plane_sigma_m = 0.01 * 1430.0 * 2.5 / 1000.0
    assert in_plane_sigma_m / shoulder_lift_m > 10.0


def test_the_gate_is_not_applied_anywhere_by_default():
    """A grep-level guarantee: nothing in the analysis path calls it. If that
    changes, this test should be the thing that makes the change deliberate."""
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[1] / "app"
    callers = [
        path.name
        for path in root.rglob("*.py")
        if "end_exhalation_windows" in path.read_text() and path.name != "respiration.py"
    ]
    assert callers == [], f"the gate is now used by {callers}; confirm the trade was measured"


def test_a_clip_with_no_detected_breaths_gates_nothing_rather_than_everything():
    """Failing closed here would discard the whole clip because the respiratory
    signal was weak, which is not a reason to lose a posture measurement."""
    trace = respiration_trace(np.full(600, 2.5), FS)
    gate = end_exhalation_windows(trace, 600)
    assert gate.retained_fraction == 0.0
    assert gate.breaths_used == 0


def test_a_negative_frame_count_is_refused():
    trace = respiration_trace(breathing(20.0, 0.25, seed=7), FS)
    with pytest.raises(ValueError):
        end_exhalation_windows(trace, -1)


# --- the ratio that is not here ---------------------------------------------


def test_the_thoracoabdominal_ratio_raises_with_its_reason():
    """It is not absent, it refuses - so someone reaching for it finds the
    arithmetic instead of an empty module."""
    with pytest.raises(NotImplementedError, match="34%"):
        thoracoabdominal_ratio()


def test_the_ratio_really_is_that_imprecise():
    """Measured rather than asserted. Two independent excursions recovered from
    noisy traces, ratio taken, spread across many clips."""
    ratios = []
    for seed in range(200):
        thorax = respiration_trace(breathing(20.0, 0.25, seed=seed), FS)
        abdomen = respiration_trace(breathing(20.0, 0.25, seed=1000 + seed), FS)
        if thorax.band_amplitude > 0 and abdomen.band_amplitude > 0:
            ratios.append(thorax.band_amplitude / abdomen.band_amplitude)

    spread = float(np.std(ratios) / np.mean(ratios))
    # Both traces have the SAME true excursion, so the true ratio is exactly 1
    # and every bit of this spread is noise.
    assert spread > 0.15, f"relative spread {spread:.2f} - if this ever falls, revisit the refusal"
