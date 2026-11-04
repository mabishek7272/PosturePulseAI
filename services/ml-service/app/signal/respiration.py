"""Respiratory phase from the depth trace, and why the amplitude ratio is not here.

What works: the PHASE. A breathing oscillation at 0.15-0.5 Hz is recoverable
from the depth trace even though its amplitude is below the per-sample noise,
because a band-pass concentrates the signal and rejects most of the noise. At
2.5 m the thoracic excursion is roughly 7 mm against a patch-median depth sigma
of 12.9 mm - a raw signal-to-noise ratio of 0.54, hopeless per sample - but the
in-band noise is only about 2 mm, giving a ratio near 3.6 across a few cycles.
Enough to say *when* the person was at end-exhalation.

What does not work, and is deliberately absent: the AMPLITUDE RATIO.

    R_resp = dZ_thorax / dZ_abdomen

Each amplitude carries about +-2 mm on a 7-10 mm excursion, so each is known to
roughly +-20-28% and the ratio to about **+-34%**. A thoraco-abdominal ratio
quoted to a third of its own value is not a measurement of breathing pattern,
and nothing in this module computes or returns one. `thoracoabdominal_ratio`
exists only to raise, so that a caller reaching for it finds the reason rather
than an absence.

The window-length finding, which decides the gate
------------------------------------------------
**Respiratory phase is not detectable on a short hold at this precision.**
Measured over 60 trials per condition at the real noise level, counting how
often a trace is called periodic:

    window    noise only    real breathing (0.2-0.33 Hz)
     10 s         0%              0%
     20 s         2%           0-90%
     40 s         2%            100%
     60 s         0%            100%

At 40 seconds and beyond the rate comes back within 0.1-0.5 breaths per minute.
Below about 24 seconds there are too few cycles for the autocorrelation to tell
breathing from noise, so the module reports `None` rather than a number.

That settles the gate for the protocol as it stands: the multi-block windows are
**10 s relaxed, 6 s habitual, 6 s standardised**. The 6-second blocks hold about
one and a half breaths. End-exhalation gating cannot be driven from any of them -
not because the trade is poor, but because the phase is not measurable there at
all. The gate below is built and tested, and it waits for a protocol with a long
enough window.

The cost of gating, if a window ever is long enough
---------------------------------------------------
`end_exhalation_windows` is honest about what it throws away. At 0.25 Hz a
10-second hold contains about 2.5 breaths; at +-250 ms per trough that is 1.25 s
of 10 - **roughly 12% of the frames**, around 37 of 300 at 30 fps.

That matters because the artifact being removed is small. Breathing lifts the
shoulders by perhaps 3 mm, against an in-plane landmark sigma of about 36 mm at
2.5 m: the artifact is **an order of magnitude below the noise it is being
separated from**. Discarding seven frames in eight to remove it is very unlikely
to be a net gain, and fewer frames also makes the spread term in
`static_metrics.aggregate` noisier and can trip the `insufficient_frames` gate.

So the gate is built, measured and **off by default**. It is offered for the
case where the arithmetic changes - a closer capture, a larger excursion, a
longer hold - not as a default improvement. `retained_fraction` is returned so a
caller can never enable it without seeing the price.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.signal.filters import bandpass

#: Respiratory fundamental band, Hz. About 9-30 breaths per minute, which spans
#: quiet standing in an adult.
RESP_LOW_HZ = 0.15
RESP_HIGH_HZ = 0.5

#: Half-width of the window kept around each end-exhalation trough, seconds.
DEFAULT_HALF_WIDTH_S = 0.25

#: Floor on the band-passed peak-to-peak, metres, below which the trace carries
#: no signal at all and no trough is reported.
#:
#: This catches the DEGENERATE case only - a constant or near-constant trace,
#: where the band-passed residue is floating-point dust (measured: 1.2e-14 m)
#: and the maxima finder happily returned 19 "breaths" from it. It is
#: deliberately far below any real excursion.
#:
#: It cannot distinguish breathing from noise, and nothing here pretends it can:
#: measured over 40-second traces, noise alone gives a band peak-to-peak of
#: 9.4-13.4 mm against 16-19 mm for real 7 mm breathing. Those ranges overlap, so
#: an amplitude threshold placed between them would be unreliable in both
#: directions. Regularity is what separates them - see `gap_cv`.
MIN_BAND_AMPLITUDE_M = 1e-6

#: Trough spacing as a fraction of the dominant period found by autocorrelation.
#:
#: A FIXED floor does not work. Set from RESP_HIGH_HZ (2 s period, so 1 s) it
#: admitted noise peaks between real troughs whenever breathing was slow: at
#: 0.2 Hz the true period is 5 s, up to four spurious troughs fitted between
#: real ones, and the recovered rate came out 17.3 per minute against a true
#: 12.0. Scaling the spacing to the period the trace actually has removes that.
TROUGH_SPACING_FRACTION = 0.6

#: Smallest autocorrelation peak at the dominant period still called periodic.
#:
#: The discriminator, and it is NOT the regularity of the trough gaps. That was
#: the first choice and it is circular: enforcing a minimum trough spacing
#: imposes regular gaps by construction, so noise-only traces came out with a
#: gap CV of 0.18-0.25 against real breathing's 0.09-0.14 and the statistic
#: stopped separating anything. The autocorrelation peak is independent of how
#: troughs are picked.
#:
#: Measured over 60 trials per condition, band-passed, at the real noise level
#: (7 mm excursion against 12.9 mm per-sample sigma):
#:
#:     window   noise p95   breathing p5
#:      40 s      0.362        0.557      <- separable
#:      20 s      0.416        0.338      <- overlapping
#:      10 s      0.412        0.115      <- badly overlapping
#:
#: 0.45 sits in the 40-second gap.
MIN_PERIODICITY = 0.45

#: Fewest complete cycles in the window before a rate is reported.
#:
#: This is the honest consequence of the table above: **respiratory phase is not
#: detectable on a short hold at this precision.** At 0.25 Hz, six cycles is 24
#: seconds. A 10-second hold carries 2.5 cycles and a 6-second block carries 1.5,
#: and at those lengths the autocorrelation peak of pure noise is
#: indistinguishable from real breathing - so no threshold on it can work, and
#: the module reports `None` rather than a number it cannot stand behind.
#:
#: Note what this means for end-exhalation gating: the multi-block protocol's
#: windows (10 s relaxed, 6 s habitual, 6 s standardised) are all shorter than
#: this, so the gate cannot be driven from them at all.
MIN_CYCLES_FOR_RATE = 6


@dataclass(frozen=True)
class RespirationTrace:
    """The band-passed depth trace and the end-exhalation moments found in it."""

    #: Band-passed series, same length as the input, in the input's units.
    filtered: np.ndarray
    #: Sample indices of end-exhalation (maximum distance from the camera).
    trough_indices: tuple[int, ...]
    fs: float
    #: Peak-to-peak of the band-passed trace. A magnitude, NOT a ratio, and not
    #: reported as a measurement of excursion - see the module docstring.
    band_amplitude: float
    #: Dominant period from the autocorrelation of the band-passed trace,
    #: seconds, or None when none stood out.
    dominant_period_s: float | None
    #: Autocorrelation value at that period, 0..1. The periodicity evidence.
    periodicity: float

    @property
    def breaths_detected(self) -> int:
        return len(self.trough_indices)

    @property
    def gap_cv(self) -> float | None:
        """Coefficient of variation of the trough gaps, or None below 3 troughs.

        Informational only. It must NOT be used to decide whether a
        trace is periodic: the minimum-spacing rule in the trough finder makes
        the gaps regular by construction, so this is partly a measure of that
        rule rather than of the signal. `is_periodic` uses the autocorrelation.
        """
        if len(self.trough_indices) < 3:
            return None
        gaps = np.diff(np.asarray(self.trough_indices)) / self.fs
        mean_gap = float(np.mean(gaps))
        return float(np.std(gaps) / mean_gap) if mean_gap > 0 else None

    @property
    def cycles_in_window(self) -> float:
        if not self.dominant_period_s or self.dominant_period_s <= 0:
            return 0.0
        return float(self.filtered.size / self.fs / self.dominant_period_s)

    @property
    def is_periodic(self) -> bool:
        """Strong enough autocorrelation, over enough cycles, to call periodic.

        Both conditions are necessary. The peak alone is unreliable on a short
        window, where pure noise reaches the same values as real breathing.
        """
        return (
            self.periodicity >= MIN_PERIODICITY
            and self.cycles_in_window >= MIN_CYCLES_FOR_RATE
        )

    @property
    def rate_per_minute(self) -> float | None:
        """Breaths per minute, or None when the trace does not support one.

        `None` in two cases, both refusals rather than best guesses: fewer than
        three troughs (two give one interval, and one interval is not a rate),
        and a trace that does not clear `is_periodic`. A mean can always be
        taken of irregular maxima; it just is not a respiratory rate.
        """
        if len(self.trough_indices) < 3 or not self.is_periodic:
            return None
        gaps = np.diff(np.asarray(self.trough_indices)) / self.fs
        mean_gap = float(np.mean(gaps))
        return 60.0 / mean_gap if mean_gap > 0 else None


def respiration_trace(
    depth_series: np.ndarray,
    fs: float,
    *,
    low_hz: float = RESP_LOW_HZ,
    high_hz: float = RESP_HIGH_HZ,
) -> RespirationTrace:
    """Band-pass the depth trace and locate end-exhalation.

    **End-exhalation is the FURTHEST point, not the nearest.** The ribcage is
    most deflated then, so that part of the chest sits at its greatest distance
    from the camera - a local MAXIMUM in depth. Taking the minimum would gate on
    peak inspiration instead, which is the opposite of the intent and would look
    entirely plausible in the output.
    """
    series = np.asarray(depth_series, dtype=float)
    if series.ndim != 1:
        raise ValueError("depth_series must be one-dimensional")

    filtered = bandpass(series, fs, low_hz, high_hz)
    amplitude = float(np.ptp(filtered)) if filtered.size else 0.0

    if amplitude < MIN_BAND_AMPLITUDE_M:
        # A constant trace. Reporting maxima of floating-point dust would be
        # inventing breaths out of nothing.
        return RespirationTrace(
            filtered=filtered,
            trough_indices=(),
            fs=fs,
            band_amplitude=amplitude,
            dominant_period_s=None,
            periodicity=0.0,
        )

    period, periodicity = _dominant_period(filtered, fs, low_hz, high_hz)
    spacing = max(1, int(round(TROUGH_SPACING_FRACTION * (period if period else 1.0 / high_hz) * fs)))
    troughs = _local_maxima(filtered, min_distance=spacing)
    return RespirationTrace(
        filtered=filtered,
        trough_indices=tuple(troughs),
        fs=fs,
        band_amplitude=amplitude,
        dominant_period_s=period,
        periodicity=periodicity,
    )


def _dominant_period(
    x: np.ndarray, fs: float, low_hz: float, high_hz: float
) -> tuple[float | None, float]:
    """Period of the strongest autocorrelation peak inside the band, seconds.

    Used to size the trough spacing. Autocorrelation rather than an FFT peak
    because the traces are short - a 10-second hold holds two or three cycles,
    which is a handful of frequency bins - and the lag domain degrades more
    gracefully there.
    """
    x = x - x.mean()
    if x.size < 8 or not np.any(x):
        return None, 0.0
    full = np.correlate(x, x, mode="full")[x.size - 1 :]
    if full[0] <= 0:
        return None, 0.0
    full = full / full[0]

    lo = max(1, int(round(fs / high_hz)))
    hi = min(full.size - 1, int(round(fs / low_hz)))
    if hi <= lo:
        return None, 0.0
    window = full[lo : hi + 1]
    best = int(np.argmax(window))
    return float((lo + best) / fs), float(window[best])


def _local_maxima(x: np.ndarray, min_distance: int) -> list[int]:
    """Indices of local maxima at least `min_distance` samples apart.

    Tallest first, so when two candidates are closer than the minimum spacing
    the stronger one survives. The endpoints are excluded: a maximum at the edge
    of the window may be the shoulder of a cycle that was cut off, and a
    half-seen breath is not an end-exhalation.
    """
    if x.size < 3:
        return []
    interior = np.arange(1, x.size - 1)
    candidates = interior[(x[1:-1] > x[:-2]) & (x[1:-1] >= x[2:])]
    if candidates.size == 0:
        return []

    kept: list[int] = []
    for index in candidates[np.argsort(-x[candidates])]:
        if all(abs(int(index) - other) >= min_distance for other in kept):
            kept.append(int(index))
    return sorted(kept)


@dataclass(frozen=True)
class ExhalationGate:
    """Which frames survive end-exhalation gating, and what it cost."""

    #: Boolean mask over the input frames.
    mask: np.ndarray
    #: Fraction of frames kept. Returned so a caller cannot enable the gate
    #: without seeing the price - see the module docstring's arithmetic.
    retained_fraction: float
    windows: tuple[tuple[int, int], ...]
    breaths_used: int

    @property
    def retained_count(self) -> int:
        return int(np.count_nonzero(self.mask))


def end_exhalation_windows(
    trace: RespirationTrace,
    n_frames: int,
    *,
    half_width_s: float = DEFAULT_HALF_WIDTH_S,
) -> ExhalationGate:
    """A mask keeping only frames within `half_width_s` of an end-exhalation.

    **Not applied anywhere by default.** See the module docstring: this discards
    about 88% of the frames to suppress an artifact roughly an order of
    magnitude below the in-plane noise, which is very unlikely to be a net gain
    at this sensor's precision. It exists so the trade can be measured rather
    than argued about.
    """
    if n_frames < 0:
        raise ValueError("n_frames must not be negative")
    half = max(1, int(round(half_width_s * trace.fs)))
    mask = np.zeros(n_frames, dtype=bool)
    windows: list[tuple[int, int]] = []
    for index in trace.trough_indices:
        start, end = max(0, index - half), min(n_frames, index + half + 1)
        if start >= end:
            continue
        mask[start:end] = True
        windows.append((start, end))
    return ExhalationGate(
        mask=mask,
        retained_fraction=float(np.count_nonzero(mask) / n_frames) if n_frames else 0.0,
        windows=tuple(windows),
        breaths_used=len(windows),
    )


def thoracoabdominal_ratio(*_args: object, **_kwargs: object) -> float:
    """Deliberately not implemented. Raises.

    `R_resp = dZ_thorax / dZ_abdomen` cannot be measured to a useful precision
    by this sensor at this distance. Each excursion is roughly 7-10 mm and each
    is known to about +-2 mm after band-passing, so the ratio carries about
    +-34% - a third of its own value.

    This raises rather than being absent so that someone reaching for it finds
    the reason. Returning a number here would put a breathing-pattern figure in
    front of a clinician that is mostly noise, and nothing in the output would
    say so.
    """
    raise NotImplementedError(
        "The thoraco-abdominal ratio is not measurable at this precision: each excursion is "
        "~7-10 mm and known to ~+-2 mm, so the ratio carries ~+-34%. Respiratory PHASE is "
        "recoverable and is what this module provides (see respiration_trace)."
    )
