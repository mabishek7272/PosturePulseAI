"""Study A agreement-with-a-reference-method statistics (ADR-018,
docs/phase4/technical-validation-study-protocol.md).

Groups validated StudyRow records (study_dataset.py) by (metric_key, side,
reference_instrument) - each is its own analysis stratum, because a
goniometer and a plumb-line photo are not interchangeable reference
instruments (the protocol's own pairing rule). Every stratum reports,
deliberately, *agreement with a reference method* - never "accuracy" or
"validation" - and carries `thresholdStatus: "not set"` until a clinical
lead fills the prespecified threshold table
(docs/phase4/technical-validation-study-protocol.md section 9).

Dependency decision (ADR-018 Part 3): this module does not import scipy,
consistent with sample_size.py's own choice to ship a z-table rather than add
scipy as a dependency. Pearson's r, the proportional-bias regression and
ICC(2,1) need only numpy. Confidence intervals use the same normal-
approximation z-table (`sample_size.z_for_confidence`) rather than an exact
Student's-t or F interval - a large-sample approximation that understates
interval width for small n. Every result names it explicitly
(`ci_method: "normal_approximation"`) so a reader never mistakes it for an
exact interval.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from app.analysis.sample_size import z_for_confidence
from app.analysis.study_dataset import StudyRow

# Pearson r between the system and reference values below this strongly
# suggests a mis-applied sign convention (a metric that should move with the
# reference instead moves against it) rather than ordinary disagreement -
# the single most likely data-entry error given this system's per-metric
# sign rules (docs/phase4/technical-validation-study-protocol.md section 3).
SIGN_INVERSION_PEARSON_R_THRESHOLD = -0.5

# |Pearson r| between (system-reference) and the pair mean at or above this
# flags a proportional bias worth a clinician's attention - the difference
# grows or shrinks systematically with the magnitude being measured, which a
# single bias number would hide.
PROPORTIONAL_BIAS_PEARSON_R_THRESHOLD = 0.5

LOA_MULTIPLIER = 1.96  # Bland-Altman 95% limits-of-agreement convention (technical_feasibility.py uses the same).
CI_METHOD = "normal_approximation"


class StudyAgreementError(ValueError):
    """Raised when a stratum cannot be analysed (e.g. no included rows)."""


@dataclass(frozen=True)
class RepeatabilityResult:
    """The reference instrument's own repeatability, from the physiotherapist's duplicate measurements."""

    n_subjects: int
    n_observations: int
    within_subject_sd: float
    coefficient_of_repeatability: float


@dataclass(frozen=True)
class ProportionalBiasResult:
    slope: float
    intercept: float
    pearson_r: float
    detected: bool


@dataclass(frozen=True)
class AgreementStratum:
    metric_key: str
    side: str | None
    reference_instrument: str
    unit: str
    n_pairs: int
    n_subjects: int
    valid_sample_rate: float
    repeated_measures_method: str  # "repeated_measures" | "subject_means" - always stated, never implied.
    bias: float
    bias_ci_low: float
    bias_ci_high: float
    sd_diff: float
    upper_loa: float
    lower_loa: float
    loa_ci_half_width: float
    rmse: float
    icc: float
    icc_ci_low: float
    icc_ci_high: float
    pearson_r: float
    sign_inversion_suspected: bool
    proportional_bias: ProportionalBiasResult
    reference_repeatability: RepeatabilityResult | None
    ci_method: str = CI_METHOD
    threshold_status: str = "not set"


def _group_key(row: StudyRow) -> tuple[str, str | None, str]:
    return (row.metric_key, row.side, row.reference_instrument)


def _within_subject_variance_components(
    values_by_subject: dict[str, list[float]],
) -> tuple[float, float, float, int, int]:
    """
    One-way random-effects ANOVA decomposition (Bland & Altman 2007's
    unbalanced-groups estimator). Returns (grand_mean, between_subject_variance,
    within_subject_variance, k_subjects, n_total). `between_subject_variance`
    is floored at 0: a negative MSB-MSW difference means the data are
    consistent with zero between-subject variance, not a sensible negative
    one. Works for k=1 (reduces to the ordinary sample variance) and for
    every subject having exactly one observation (reduces to pure
    between-subject variance, zero within).
    """
    groups = [v for v in values_by_subject.values() if len(v) > 0]
    k = len(groups)
    if k == 0:
        raise StudyAgreementError("Cannot compute variance components from zero subjects.")
    all_values = [x for group in groups for x in group]
    n = len(all_values)
    grand_mean = float(np.mean(all_values))

    if k < 2:
        within = float(np.var(all_values, ddof=1)) if n > 1 else 0.0
        return grand_mean, 0.0, within, k, n

    ssw = 0.0
    ssb = 0.0
    sum_ni2 = 0.0
    for group in groups:
        ni = len(group)
        group_mean = float(np.mean(group))
        ssw += float(np.sum((np.asarray(group, dtype=float) - group_mean) ** 2))
        ssb += ni * (group_mean - grand_mean) ** 2
        sum_ni2 += ni**2

    df_within = n - k
    msw = ssw / df_within if df_within > 0 else 0.0

    df_between = k - 1
    msb = ssb / df_between
    n0 = (n - sum_ni2 / n) / df_between if df_between > 0 else 0.0
    between = max((msb - msw) / n0, 0.0) if n0 > 0 else 0.0

    return grand_mean, between, msw, k, n


def _bias_and_spread_subject_means(diffs_by_subject: dict[str, list[float]]) -> tuple[float, float, int]:
    """Averages each subject's trials first, then runs a one-sample Bland-Altman on the subject means."""
    means = [float(np.mean(v)) for v in diffs_by_subject.values() if v]
    if not means:
        raise StudyAgreementError("Cannot compute subject-means agreement from zero subjects.")
    arr = np.asarray(means, dtype=float)
    bias = float(np.mean(arr))
    sd = float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0
    return bias, sd, len(arr)


def _safe_pearson(a: np.ndarray, b: np.ndarray) -> float:
    if len(a) < 2 or float(np.std(a)) == 0.0 or float(np.std(b)) == 0.0:
        return 0.0
    r = float(np.corrcoef(a, b)[0, 1])
    return 0.0 if math.isnan(r) else r


def _proportional_bias(system: np.ndarray, reference: np.ndarray) -> ProportionalBiasResult:
    diffs = system - reference
    means = (system + reference) / 2.0
    if len(diffs) < 2 or float(np.std(means)) == 0.0:
        slope, intercept, r = 0.0, float(np.mean(diffs)), 0.0
    else:
        slope, intercept = (float(c) for c in np.polyfit(means, diffs, 1))
        r = _safe_pearson(means, diffs)
    return ProportionalBiasResult(
        slope=slope, intercept=intercept, pearson_r=r, detected=abs(r) >= PROPORTIONAL_BIAS_PEARSON_R_THRESHOLD
    )


def _subject_means_of(rows: list[StudyRow], field: str) -> dict[str, float]:
    data: dict[str, list[float]] = {}
    for r in rows:
        value = getattr(r, field)
        data.setdefault(r.subject_id, []).append(value)
    return {k: float(np.mean(v)) for k, v in data.items() if v}


def _icc_2_1(system_by_subject: dict[str, float], reference_by_subject: dict[str, float]) -> tuple[float, float, int]:
    """
    ICC(2,1), two-way random-effects, single measures, agreement form
    (Shrout & Fleiss 1979), treating "system" and "reference" as the two
    raters over each subject's mean. Returns (icc, standard_error, n_subjects).
    The standard error is McGraw & Wong's (1996) large-sample normal
    approximation for a 2-rater ICC, not an exact F-based interval - the
    module-level dependency decision (no scipy).
    """
    subjects = sorted(set(system_by_subject) & set(reference_by_subject))
    n = len(subjects)
    if n < 2:
        raise StudyAgreementError("ICC needs at least 2 subjects with both a system and a reference value.")

    x = np.array([[system_by_subject[s], reference_by_subject[s]] for s in subjects], dtype=float)
    m = 2
    grand_mean = float(x.mean())
    row_means = x.mean(axis=1)
    col_means = x.mean(axis=0)

    sst = float(np.sum((x - grand_mean) ** 2))
    ssr = m * float(np.sum((row_means - grand_mean) ** 2))
    ssc = n * float(np.sum((col_means - grand_mean) ** 2))
    sse = sst - ssr - ssc

    msr = ssr / (n - 1)
    msc = ssc / (m - 1)
    mse = sse / ((n - 1) * (m - 1)) if (n - 1) * (m - 1) > 0 else 0.0

    denom = msr + (m - 1) * mse + (m / n) * (msc - mse)
    if denom == 0:
        icc = 1.0 if msr == 0 else 0.0
    else:
        icc = (msr - mse) / denom

    icc_clamped = min(max(icc, -0.999999), 0.999999)
    variance = ((1 - icc_clamped) ** 2 * (1 + icc_clamped) ** 2) / (n - 1) if n > 1 else 0.0
    se = math.sqrt(max(variance, 0.0))
    return icc, se, n


def _reference_repeatability(included: list[StudyRow]) -> RepeatabilityResult | None:
    by_subject: dict[str, list[float]] = {}
    for r in included:
        by_subject.setdefault(r.subject_id, []).append(r.reference_value)  # type: ignore[arg-type]
    repeat_groups = {k: v for k, v in by_subject.items() if len(v) >= 2}
    if not repeat_groups:
        return None
    _, _, within_var, k, n = _within_subject_variance_components(repeat_groups)
    s_w = math.sqrt(within_var)
    cr = LOA_MULTIPLIER * math.sqrt(2) * s_w
    return RepeatabilityResult(n_subjects=k, n_observations=n, within_subject_sd=s_w, coefficient_of_repeatability=cr)


def _compute_one_stratum(
    key: tuple[str, str | None, str],
    group_rows: list[StudyRow],
    confidence: float,
    repeated_measures_method: str,
) -> AgreementStratum:
    metric_key, side, instrument = key
    included = [r for r in group_rows if r.included]
    if not included:
        raise StudyAgreementError(f"Stratum {key} has no included rows to analyse.")

    unit = group_rows[0].unit
    n_pairs = len(included)
    n_total = len(group_rows)
    n_subjects = len({r.subject_id for r in included})
    valid_sample_rate = n_pairs / n_total

    system = np.array([r.system_value for r in included], dtype=float)
    reference = np.array([r.reference_value for r in included], dtype=float)
    diffs = system - reference

    diffs_by_subject: dict[str, list[float]] = {}
    for r, d in zip(included, diffs):
        diffs_by_subject.setdefault(r.subject_id, []).append(float(d))

    if repeated_measures_method == "repeated_measures":
        grand_mean, between, within, _k, se_n = _within_subject_variance_components(diffs_by_subject)
        bias = grand_mean
        sd_diff = math.sqrt(between + within)
    elif repeated_measures_method == "subject_means":
        bias, sd_diff, se_n = _bias_and_spread_subject_means(diffs_by_subject)
    else:
        raise ValueError(f"Unknown repeated_measures_method {repeated_measures_method!r}")

    z = z_for_confidence(confidence)
    bias_se = sd_diff / math.sqrt(se_n) if se_n > 0 else 0.0
    loa_ci_half_width = z * sd_diff * math.sqrt(3 / se_n) if se_n > 0 else 0.0

    rmse = float(math.sqrt(np.mean(diffs**2)))

    icc, icc_se, _icc_n = _icc_2_1(_subject_means_of(included, "system_value"), _subject_means_of(included, "reference_value"))

    pearson_r = _safe_pearson(system, reference)

    return AgreementStratum(
        metric_key=metric_key,
        side=side,
        reference_instrument=instrument,
        unit=unit,
        n_pairs=n_pairs,
        n_subjects=n_subjects,
        valid_sample_rate=valid_sample_rate,
        repeated_measures_method=repeated_measures_method,
        bias=bias,
        bias_ci_low=bias - z * bias_se,
        bias_ci_high=bias + z * bias_se,
        sd_diff=sd_diff,
        upper_loa=bias + LOA_MULTIPLIER * sd_diff,
        lower_loa=bias - LOA_MULTIPLIER * sd_diff,
        loa_ci_half_width=loa_ci_half_width,
        rmse=rmse,
        icc=icc,
        icc_ci_low=max(icc - z * icc_se, -1.0),
        icc_ci_high=min(icc + z * icc_se, 1.0),
        pearson_r=pearson_r,
        sign_inversion_suspected=pearson_r < SIGN_INVERSION_PEARSON_R_THRESHOLD,
        proportional_bias=_proportional_bias(system, reference),
        reference_repeatability=_reference_repeatability(included),
    )


def compute_agreement(
    rows: list[StudyRow],
    *,
    confidence: float = 0.95,
    repeated_measures_method: str = "repeated_measures",
) -> list[AgreementStratum]:
    """
    Computes one AgreementStratum per (metric_key, side, reference_instrument)
    group in `rows`. `repeated_measures_method` is passed straight through to
    every stratum's `repeated_measures_method` field - never inferred - so a
    reader always knows which of the two methods (ADR-018 Part 3) produced
    the bias/limits-of-agreement for that run.
    """
    if repeated_measures_method not in ("repeated_measures", "subject_means"):
        raise ValueError(f"Unknown repeated_measures_method {repeated_measures_method!r}")
    strata: dict[tuple[str, str | None, str], list[StudyRow]] = {}
    for row in rows:
        strata.setdefault(_group_key(row), []).append(row)

    results = [
        _compute_one_stratum(key, group_rows, confidence, repeated_measures_method) for key, group_rows in strata.items()
    ]
    return sorted(results, key=lambda s: (s.metric_key, s.side or "", s.reference_instrument))
