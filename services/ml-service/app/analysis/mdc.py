"""Minimal detectable change, built so it cannot be computed from the wrong thing.

    MDC95 = z * sqrt(2) * SEM_between_session

ADR-020 section 7 forbids computing or displaying any MDC figure until a
test-retest dataset exists, and gives the reason: **within-clip sigma is 5-20x
smaller than between-session sigma**, so an MDC derived from it sets the
threshold far too low and flags ordinary measurement noise as real change - a
false-progression path on a real patient. Simulated below in the tests: with a
between-session SEM of 2.0 and a within-clip sigma of 0.2, a within-clip MDC
calls about 85% of no-change pairs "changed" (analytically 84.5%); the correct one 5%.

So this module's job is to make the wrong input unrepresentable, not merely
documented:

- There is no parameter that accepts a bare number. The SEM must be a
  `BetweenSessionSEM`, which carries where it came from (dataset id, number of
  subjects, the metric and method it describes) and refuses to exist without
  them. A float cannot say it is a within-clip standard deviation; this can say
  it is not.
- The only intended constructor is `from_test_retest`, which takes paired values
  from the SAME subjects on DIFFERENT days and computes the SEM itself.
- Nothing here imports the filter module, `static_metrics`, or any per-clip
  quantity, and a test asserts that stays true.

What this does NOT do, stated plainly: it cannot stop someone constructing a
`BetweenSessionSEM(...)` by hand with an invented number and a made-up dataset
id. The gate is that doing so means writing down a dataset and a sample size -
a deliberate false statement rather than an accident. Provenance fields are a
speed bump for honest mistakes, not a defence against dishonesty.

**Not wired to anything.** No report, comparison or UI calls this, and
`test_mdc.py` asserts no module under `app/` imports it. No between-session
dataset exists yet, so no value can be supplied; `apps/mobile/src/lib/compare.ts`
keeps its existing combined-uncertainty gate, which makes no claim about
between-visit reliability and says so.

"Significant" here means the change exceeds the measurement's own random noise.
It does NOT mean clinically meaningful - that is a separate quantity (a minimal
clinically important difference) set by clinical judgement, not derived from
this instrument's noise.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import NormalDist

import numpy as np

#: Fewest subjects a between-session SEM may rest on.
#:
#: An ENGINEERING FLOOR, not a study protocol - the repo has no test-retest
#: sample size, and `sample_size.py` is explicit that precision targets are the
#: clinical lead's to set. It exists so a pilot of five people cannot mint a
#: threshold. The cost of a small n is concrete: the SEM's relative 95% half-width
#: is about `1.96 / sqrt(2 (n - 1))` (see `sem_relative_halfwidth`), which is
#: 37% at n=15, 26% at n=30, 20% at n=50. At 30 the MDC itself is uncertain by
#: roughly a quarter, which `relative_halfwidth` surfaces rather than hides.
MIN_SUBJECTS = 30

#: Shortest gap between the two measurements of a pair, hours.
#:
#: Different DAY, so two scans of one visit cannot pass as a test-retest pair.
#: Same-visit repeats reproduce the same set-up, the same clothing and the same
#: landmark offsets, which is exactly the static error that makes within-clip
#: sigma so much smaller than the real one.
MIN_INTERVAL_HOURS = 24.0

_NORMAL = NormalDist()


class MDCRefusal(ValueError):
    """The inputs cannot support a minimal detectable change. Deliberately its
    own type so a caller cannot confuse a refusal with a bad argument."""


def z_for_confidence(confidence_level: float) -> float:
    """Two-sided normal critical value, from the standard library.

    `statistics.NormalDist` rather than scipy (not a dependency) or a lookup
    table (which silently fails for a level it does not list).
    """
    if not (0.0 < confidence_level < 1.0):
        raise ValueError("confidence_level must be strictly between 0 and 1")
    return _NORMAL.inv_cdf(1.0 - (1.0 - confidence_level) / 2.0)


@dataclass(frozen=True)
class BetweenSessionSEM:
    """A standard error of measurement estimated from test-retest data.

    Carries its own provenance so it cannot be mistaken for any other sigma, and
    so it cannot be applied to a metric or method it was not measured on:
    reliability is a property of a (metric, method) pair, and a 2D tilt's SEM
    says nothing about a 2.5D one.
    """

    value: float
    metric_key: str
    measurement_method: str
    #: Subjects who each contributed a pair of sessions.
    n_subjects: int
    #: Identifies the dataset the value was estimated from.
    dataset_id: str

    def __post_init__(self) -> None:
        if not (isinstance(self.value, (int, float)) and math.isfinite(self.value) and self.value > 0):
            raise MDCRefusal("a SEM must be a finite positive number")
        if not self.metric_key or not self.measurement_method:
            raise MDCRefusal("a SEM must name the metric and measurement method it was estimated on")
        if not self.dataset_id or not self.dataset_id.strip():
            raise MDCRefusal(
                "a SEM must name the test-retest dataset it came from; a number with no dataset "
                "is indistinguishable from a within-clip standard deviation"
            )
        if self.n_subjects < MIN_SUBJECTS:
            raise MDCRefusal(
                f"a SEM from {self.n_subjects} subjects cannot mint a threshold "
                f"(floor is {MIN_SUBJECTS}); its own uncertainty is about "
                f"{100 * sem_relative_halfwidth(max(self.n_subjects, 2)):.0f}%"
            )

    @property
    def relative_halfwidth(self) -> float:
        """Approximate relative 95% half-width of this SEM, from `n_subjects`.

        Surfaced so a report can show how well-determined the threshold is
        instead of presenting an MDC as exact.
        """
        return sem_relative_halfwidth(self.n_subjects)

    @classmethod
    def from_test_retest(
        cls,
        *,
        session_a: np.ndarray,
        session_b: np.ndarray,
        hours_between: np.ndarray,
        metric_key: str,
        measurement_method: str,
        dataset_id: str,
    ) -> "BetweenSessionSEM":
        """Estimate the SEM from paired values of the SAME subjects on DIFFERENT days.

            SEM = sd(session_b - session_a) / sqrt(2)

        The standard difference-based estimator. It estimates RANDOM error only:
        a constant shift between sessions (a learning effect, a systematic
        change of set-up) leaves it unchanged, so it is a separate thing to look
        for and is not folded in here.

        `hours_between` is required, per pair, and every pair must be at least
        `MIN_INTERVAL_HOURS` apart. Two scans of one visit would share the
        static landmark and soft-tissue offsets that dominate real error, and
        would understate the SEM in exactly the way this module exists to
        prevent.
        """
        a = np.asarray(session_a, dtype=float)
        b = np.asarray(session_b, dtype=float)
        hours = np.asarray(hours_between, dtype=float)
        if a.ndim != 1 or a.shape != b.shape or a.shape != hours.shape:
            raise MDCRefusal("session_a, session_b and hours_between must be 1-D arrays of one length")
        if not (np.all(np.isfinite(a)) and np.all(np.isfinite(b)) and np.all(np.isfinite(hours))):
            raise MDCRefusal("test-retest data must be finite; drop incomplete pairs before estimating")
        if np.any(hours < MIN_INTERVAL_HOURS):
            raise MDCRefusal(
                f"every pair must be at least {MIN_INTERVAL_HOURS:g} hours apart; got a minimum of "
                f"{float(hours.min()):g}. Same-visit repeats share the static offsets that make "
                "within-clip variation so much smaller than the real one."
            )
        if a.size < MIN_SUBJECTS:
            raise MDCRefusal(f"{a.size} pairs is below the floor of {MIN_SUBJECTS} subjects")

        sd_diff = float(np.std(b - a, ddof=1))
        if sd_diff <= 0.0:
            # Identical values in both sessions for every subject: not a
            # reliability result, a sign the same number was entered twice.
            raise MDCRefusal("all paired differences are zero; this is not a test-retest result")
        return cls(
            value=sd_diff / math.sqrt(2.0),
            metric_key=metric_key,
            measurement_method=measurement_method,
            n_subjects=int(a.size),
            dataset_id=dataset_id,
        )


def sem_relative_halfwidth(n_subjects: int) -> float:
    """Approximate relative 95% half-width of an SEM estimated from `n` pairs.

    `1.96 / sqrt(2 (n - 1))`, the large-sample result for a standard deviation.
    Approximate, and optimistic for small n.
    """
    if n_subjects < 2:
        raise ValueError("need at least 2 subjects")
    return 1.96 / math.sqrt(2.0 * (n_subjects - 1))


def minimal_detectable_change(
    sem_between_session: BetweenSessionSEM,
    *,
    metric_key: str,
    measurement_method: str,
    confidence_level: float = 0.95,
) -> float:
    """`z * sqrt(2) * SEM`, in the metric's own unit.

    `metric_key` and `measurement_method` are required, and must match the SEM's:
    reliability belongs to a (metric, method) pair, so a threshold estimated on
    one cannot be applied to another. The `sqrt(2)` is there because a change
    compares TWO measurements, each carrying the SEM.
    """
    _require_sem(sem_between_session)
    if (
        sem_between_session.metric_key != metric_key
        or sem_between_session.measurement_method != measurement_method
    ):
        raise MDCRefusal(
            f"this SEM was estimated on ({sem_between_session.metric_key}, "
            f"{sem_between_session.measurement_method}) and cannot be applied to "
            f"({metric_key}, {measurement_method})"
        )
    return z_for_confidence(confidence_level) * math.sqrt(2.0) * sem_between_session.value


def is_statistically_significant_change(
    delta: float,
    sem_between_session: BetweenSessionSEM,
    *,
    metric_key: str,
    measurement_method: str,
    confidence_level: float = 0.95,
) -> bool:
    """Whether `|delta|` exceeds the minimal detectable change.

    Strictly greater: a change exactly equal to the threshold is not called
    detectable. A non-finite `delta` raises instead of returning False, because
    "not significant" would be a claim about a change that was never measured.

    This says the change is larger than the measurement's own random noise. It
    does NOT say the change matters clinically.
    """
    if not isinstance(delta, (int, float)) or not math.isfinite(delta):
        raise ValueError("delta must be a finite number")
    mdc = minimal_detectable_change(
        sem_between_session,
        metric_key=metric_key,
        measurement_method=measurement_method,
        confidence_level=confidence_level,
    )
    return abs(float(delta)) > mdc


def _require_sem(value: object) -> None:
    if not isinstance(value, BetweenSessionSEM):
        raise TypeError(
            "the SEM must be a BetweenSessionSEM built from a test-retest dataset, not "
            f"{type(value).__name__}. A bare number cannot say whether it is a between-session "
            "SEM or a within-clip standard deviation, and an MDC from the latter flags "
            "ordinary noise as real change (ADR-020 section 7)."
        )
