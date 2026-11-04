"""Zero-phase Butterworth filtering, in pure numpy.

`scipy` is not a dependency of this service (only mediapipe, numpy, pydantic,
av, fastapi), so `scipy.signal.butter` / `filtfilt` are not available and adding
scipy for three functions is a supply-chain decision rather than a convenience.
Everything here is designed from the analogue prototype and bilinear-transformed,
and `filtfilt` is implemented as the usual forward-backward pass with odd
reflection padding. `test_filters.py` pins the design against the properties a
Butterworth must have (-3 dB at the cutoff, unity DC gain, monotonic roll-off,
exact zero phase) rather than against scipy's numbers, so the absence of scipy
is not a gap in the verification.

What the residual is, and what it is NOT
---------------------------------------
Low-pass the series and the difference `r(t) = theta(t) - theta_LP(t)` is the
high-frequency part of the signal. It is a real, useful quantity: it measures
frame-to-frame jitter, and a clip whose jitter is unusually high is a clip worth
looking at.

**It is not the measurement's uncertainty, and it must never replace the
declared one.** ADR-020 section 6 settles this, and the arithmetic is in
`app/metrics/static_metrics.py`'s own model: the dominant error terms -
landmark-to-bony-landmark offset, soft tissue and clothing, the pose model's
left/right joint-centre asymmetry - are **static within a clip**. They sit below
any cutoff usable over a 10-second hold and pass through this filter untouched,
so they appear in neither `theta_LP` nor `r`. On the noise model the test suite
is calibrated against, 80% of the in-plane variance is static, which means
`std(r)` sees only the remaining 20% and **understates the true sigma by about
2.2x**. Substituting it would make every reported uncertainty tighter while the
underlying bias was unchanged - the instrument claiming precision it does not
have.

So `jitter_sigma` exists and is exported, and `combine_in_quadrature` is the
only way this module offers to get it into an uncertainty. A clip-health
clip-health signal, added, never a substitute.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

#: Cutoff for postural sway, Hz. Voluntary sway and the body's own balance
#: corrections live below this; above it is sensor and landmark jitter.
DEFAULT_CUTOFF_HZ = 1.5

#: Order of the analogue prototype. `filtfilt` applies it twice, so the
#: effective roll-off is 8th order - which is why the padding below matters.
DEFAULT_ORDER = 4

#: How many standard errors a creep slope must clear to be called a drift.
#:
#: THREE, not the conventional two, and the number is measured rather than
#: chosen. Even after correcting the standard error for the autocorrelation the
#: low-pass leaves (see `creep_slope`), a 2-sigma threshold flagged a drift in
#: 6.5% of pure-noise 13-second clips and **10.5% of 10-second ones** - the rate
#: worsens as the window shortens, because the effective sample count falls with
#: it. At 3 sigma that drops to about 1%, while a true drift of 0.1 units per
#: second in unit-variance noise is still detected in 100 of 100 trials.
#:
#: So the stricter threshold costs nothing measurable in sensitivity and removes
#: most of the false positives. On a quantity a clinician could read as fatigue,
#: that trade is not close.
SIGNIFICANCE_SIGMA = 3.0


def butter_lowpass(cutoff_hz: float, fs: float, order: int = DEFAULT_ORDER) -> tuple[np.ndarray, np.ndarray]:
    """Digital Butterworth low-pass coefficients `(b, a)`.

    Analogue prototype poles, frequency-prewarped, then bilinear-transformed -
    the textbook route, written out because scipy is not available. Prewarping
    with `tan` is what makes the digital -3 dB point land exactly on
    `cutoff_hz` instead of near it.
    """
    if not (fs > 0):
        raise ValueError("fs must be positive")
    if not (0 < cutoff_hz < fs / 2):
        raise ValueError(f"cutoff {cutoff_hz} Hz must be between 0 and the Nyquist frequency {fs / 2} Hz")
    if order < 1:
        raise ValueError("order must be at least 1")

    # Analogue Butterworth poles on the unit circle's left half, |s| = 1.
    k = np.arange(1, order + 1)
    analogue_poles = np.exp(1j * np.pi * (2 * k + order - 1) / (2 * order))

    # Prewarp so the bilinear transform's frequency compression does not move
    # the cutoff: omega_a = 2 fs tan(pi fc / fs).
    warped = 2.0 * fs * np.tan(np.pi * cutoff_hz / fs)
    scaled = analogue_poles * warped

    # Bilinear: s -> 2 fs (z - 1) / (z + 1). A low-pass prototype's zeros all
    # land at z = -1.
    two_fs = 2.0 * fs
    z_poles = (1.0 + scaled / two_fs) / (1.0 - scaled / two_fs)
    z_zeros = -np.ones(order)

    b = np.poly(z_zeros).real
    a = np.poly(z_poles).real
    # Unity gain at DC (z = 1), so a held posture is not scaled.
    b = b * (a.sum() / b.sum())
    return b, a


def lfilter_zi(b: np.ndarray, a: np.ndarray) -> np.ndarray:
    """Initial filter state whose steady-state output is 1 for a constant input of 1.

    Without this, `lfilter` starts from zero state and a constant input produces
    a startup transient as the filter charges. That transient is not small: for
    the 4th-order design here it left a constant 5.0 deviating by **0.56** after
    `filtfilt`, and it put a floor of about 0.1 on the stopband - so a 10 Hz
    component came out at a tenth of its amplitude instead of a thousandth,
    because the measured "attenuation" was really edge transient. Scaling this
    by the first sample makes the filter begin already settled on it.

    Solves `(I - A^T) zi = b[1:] - a[1:] b[0]` with `A` the companion matrix of
    `a`, which is the steady-state condition for the direct-form II transposed
    recurrence below.
    """
    b = np.asarray(b, dtype=float)
    a = np.asarray(a, dtype=float)
    b = b / a[0]
    a = a / a[0]
    n = max(len(a), len(b))
    if n <= 1:
        return np.zeros(0)
    a_pad = np.concatenate([a, np.zeros(n - len(a))])
    b_pad = np.concatenate([b, np.zeros(n - len(b))])

    companion = np.zeros((n - 1, n - 1))
    companion[0, :] = -a_pad[1:n]
    if n > 2:
        companion[1:, :-1] = np.eye(n - 2)

    rhs = b_pad[1:n] - a_pad[1:n] * b_pad[0]
    return np.linalg.solve(np.eye(n - 1) - companion.T, rhs)


def lfilter(b: np.ndarray, a: np.ndarray, x: np.ndarray, zi: np.ndarray | None = None) -> np.ndarray:
    """Direct-form II transposed IIR filter. Causal, so it has phase lag."""
    b = np.asarray(b, dtype=float) / a[0]
    a = np.asarray(a, dtype=float) / a[0]
    n = max(len(a), len(b)) - 1
    state = np.zeros(n) if zi is None else np.asarray(zi, dtype=float).copy()
    out = np.empty(len(x), dtype=float)
    for i, sample in enumerate(np.asarray(x, dtype=float)):
        y = b[0] * sample + (state[0] if n else 0.0)
        for j in range(n - 1):
            state[j] = b[j + 1] * sample - a[j + 1] * y + state[j + 1]
        if n:
            state[n - 1] = b[n] * sample - a[n] * y
        out[i] = y
    return out


def filtfilt(b: np.ndarray, a: np.ndarray, x: np.ndarray) -> np.ndarray:
    """Zero-phase filtering: forward, reversed, forward, reversed.

    Zero phase matters here because the output is compared against landmark
    positions at the same timestamps. A causal filter's lag would shift the
    smoothed series relative to the frames it came from, and a sway trace
    shifted by 100 ms against its own frame times is a different measurement.

    **Edges are padded by odd reflection**, as scipy does. Without it the
    filter's transient - which an 8th-order effective response spreads over
    several tenths of a second - eats both ends of the window. Over a 10-second
    hold that is a measurable fraction of the data, and the damage is at exactly
    the two places a creep slope is most sensitive to.
    """
    x = np.asarray(x, dtype=float)
    pad = 3 * max(len(a), len(b))
    if x.size <= pad:
        # Too short to pad, so too short to filter without the transient
        # dominating. Refused rather than returned with eaten ends.
        raise ValueError(f"series of {x.size} samples is too short for this filter (needs > {pad})")

    # Odd reflection: mirror about the endpoint VALUE, not just the index, so a
    # series with a trend does not get an artificial step at the boundary.
    front = 2.0 * x[0] - x[pad:0:-1]
    back = 2.0 * x[-1] - x[-2 : -pad - 2 : -1]
    padded = np.concatenate([front, x, back])

    # Each pass starts already settled on its own first sample, so neither
    # direction contributes a charging transient.
    zi = lfilter_zi(b, a)
    forward = lfilter(b, a, padded, zi * padded[0])
    reversed_forward = forward[::-1]
    backward = lfilter(b, a, reversed_forward, zi * reversed_forward[0])[::-1]
    return backward[pad : pad + x.size]


def lowpass(series: np.ndarray, fs: float, cutoff_hz: float = DEFAULT_CUTOFF_HZ, order: int = DEFAULT_ORDER) -> np.ndarray:
    b, a = butter_lowpass(cutoff_hz, fs, order)
    return filtfilt(b, a, series)


def bandpass(
    series: np.ndarray, fs: float, low_hz: float, high_hz: float, order: int = 2
) -> np.ndarray:
    """Band-pass as a low-pass of a high-passed series.

    Built from two low-passes rather than a band-pass prototype: a narrow
    band-pass at these frequencies (0.15-0.5 Hz against a 30 Hz sample rate) has
    poles close enough to the unit circle that the direct-form implementation
    above loses accuracy, while the difference-of-low-passes form stays
    well-conditioned. The price is a gentler skirt, which does not matter for
    finding a respiratory fundamental.
    """
    if not (0 < low_hz < high_hz < fs / 2):
        raise ValueError("need 0 < low < high < Nyquist")
    return lowpass(series, fs, high_hz, order) - lowpass(series, fs, low_hz, order)


@dataclass(frozen=True)
class Decomposition:
    """A series split into its low-frequency part and the rest."""

    low: np.ndarray
    residual: np.ndarray
    fs: float
    cutoff_hz: float

    @property
    def jitter_sigma(self) -> float:
        """`std(residual)`: measured frame-to-frame jitter in the input's units.

        **Not the measurement uncertainty.** See the module docstring: the
        dominant error terms are static within a clip and are invisible here.
        Use `combine_in_quadrature`.
        """
        return float(np.std(self.residual))


def decompose(series: np.ndarray, fs: float, cutoff_hz: float = DEFAULT_CUTOFF_HZ, order: int = DEFAULT_ORDER) -> Decomposition:
    series = np.asarray(series, dtype=float)
    low = lowpass(series, fs, cutoff_hz, order)
    return Decomposition(low=low, residual=series - low, fs=fs, cutoff_hz=cutoff_hz)


def combine_in_quaduature(declared_sigma: float, jitter_sigma: float) -> float:  # pragma: no cover - alias
    return combine_in_quadrature(declared_sigma, jitter_sigma)


def combine_in_quadrature(declared_sigma: float, jitter_sigma: float) -> float:
    """`sqrt(declared^2 + jitter^2)`. The ONLY way jitter enters an uncertainty.

    The declared term stays whole. It covers the static biases the filter cannot
    see, and the measured jitter is an addition to them, not a measurement of
    them. `max(declared, jitter)` or a substitution would both discard the part
    of the error that dominates (ADR-020 section 6).
    """
    if declared_sigma < 0 or jitter_sigma < 0:
        raise ValueError("sigmas must not be negative")
    return float(np.hypot(declared_sigma, jitter_sigma))


@dataclass(frozen=True)
class CreepFit:
    """A straight line through the low-passed hold."""

    #: Units of the input per second. Positive means increasing.
    slope_per_second: float
    intercept: float
    #: Standard error of the slope, same units.
    slope_stderr: float
    #: Total change across the fitted window, `slope * duration`.
    total_change: float
    n_samples: int

    @property
    def is_significant(self) -> bool:
        """Slope at least `SIGNIFICANCE_SIGMA` times its own standard error.

        A drift smaller than this is indistinguishable from the sway it was
        fitted through, and reporting it as a direction would be reading a trend
        out of noise.
        """
        return self.slope_stderr > 0 and abs(self.slope_per_second) >= SIGNIFICANCE_SIGMA * self.slope_stderr


def creep_slope(series: np.ndarray, fs: float, cutoff_hz: float = DEFAULT_CUTOFF_HZ) -> CreepFit:
    """Progressive drift across a hold, fitted to the LOW-PASSED series.

    Fitted to the smoothed trace on purpose. Sway is close to zero-mean over a
    hold, so in principle it does not bias a least-squares slope - but over the
    two or three cycles a 10-second hold contains it does not average out
    either, and a single slow oscillation can masquerade as a trend. Removing it
    first means the slope describes the direction the person is drifting rather
    than where in a sway cycle the clip happened to start and end.

    The slope's standard error is returned alongside it, because a drift that
    does not clear its own noise is not a finding - and it is corrected for the
    autocorrelation the low-pass leaves behind, without which it flagged a drift
    in 60% of pure-noise clips. See the comment at the correction.
    """
    low = lowpass(series, fs, cutoff_hz)
    n = low.size
    t = np.arange(n) / fs
    slope, intercept = np.polyfit(t, low, 1)

    residual = low - (slope * t + intercept)
    if n > 2:
        # OLS slope standard error, then corrected for autocorrelation.
        #
        # The correction is not a refinement, it is the difference between a
        # usable statistic and a misleading one. OLS assumes independent
        # residuals; after low-passing at `cutoff_hz` consecutive samples are
        # heavily correlated, and the number of INDEPENDENT samples is roughly
        # the fraction of the band retained: `n * 2 * fc / fs`. At 1.5 Hz on a
        # 30 Hz series that is a tenth of the samples, so the honest standard
        # error is about sqrt(10) = 3.2x the OLS one.
        #
        # Measured: with the uncorrected figure, **24 of 40** pure-noise clips
        # reported a "significant" postural drift - a 60% false-positive rate on
        # a quantity a clinician might read as fatigue. With the correction it
        # is a handful. Same family of error as deriving a minimal detectable
        # change from within-clip sigma, which ADR-020 section 7 rejects for the
        # same reason: noise presented as progression.
        dof = n - 2
        s_sq = float(residual @ residual) / dof
        t_var = float(((t - t.mean()) ** 2).sum())
        ols = float(np.sqrt(s_sq / t_var)) if t_var > 0 else 0.0
        independent_fraction = min(1.0, 2.0 * cutoff_hz / fs)
        stderr = ols / float(np.sqrt(independent_fraction))
    else:
        stderr = 0.0

    return CreepFit(
        slope_per_second=float(slope),
        intercept=float(intercept),
        slope_stderr=stderr,
        total_change=float(slope * (n - 1) / fs),
        n_samples=int(n),
    )
