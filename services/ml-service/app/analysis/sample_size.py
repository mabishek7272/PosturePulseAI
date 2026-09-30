"""Sample-size / power calculators for docs/phase4/statistical-analysis-plan.md.

Gives the clinical lead real tooling to turn an *assumed* effect size (from
prior literature or a pilot) into a minimum enrollment target - it does not
choose the assumed effect size, the desired precision, or the confidence
level itself. Those are clinical/statistical decisions
(study-charter-skeleton.md marks them TBD) that this module only turns into
a number once given.

Formulas used are standard, textbook approximations for a normal-
approximation study design - not something derived from this codebase's own
data, and not a substitute for a biostatistician's review before a real
study protocol is finalized.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

# Two-sided normal-distribution critical values for common confidence
# levels - avoids adding scipy as a dependency just for norm.ppf. Extend
# this table (or switch to scipy) if a level outside it is ever needed.
_Z_FOR_CONFIDENCE = {
    0.80: 1.2816,
    0.90: 1.6449,
    0.95: 1.9600,
    0.99: 2.5758,
}


def z_for_confidence(confidence: float) -> float:
    if confidence not in _Z_FOR_CONFIDENCE:
        raise ValueError(
            f"No tabulated z-value for confidence={confidence}. "
            f"Supported: {sorted(_Z_FOR_CONFIDENCE)}. Add a value rather than approximating."
        )
    return _Z_FOR_CONFIDENCE[confidence]


@dataclass(frozen=True)
class BlandAltmanSampleSize:
    n: int
    assumed_sd_diff: float
    desired_loa_half_width: float
    confidence: float


def bland_altman_sample_size(
    assumed_sd_diff: float, desired_loa_half_width: float, confidence: float = 0.95
) -> BlandAltmanSampleSize:
    """
    Minimum paired samples to estimate the 95% Bland-Altman limits of
    agreement within +/- `desired_loa_half_width` degrees, given an assumed
    SD of the system-vs-reference differences (from a pilot or prior
    literature - not computed here).

    Uses the standard large-sample approximation for the variance of a
    Bland-Altman limit of agreement, Var(LoA) ~= sigma^2 * 3/n (the
    1.96-multiplier LoA case), giving
    n = (z_confidence^2 * 3 * sigma^2) / desired_loa_half_width^2.
    """
    if assumed_sd_diff <= 0:
        raise ValueError("assumed_sd_diff must be positive - it cannot be estimated from zero variance.")
    if desired_loa_half_width <= 0:
        raise ValueError("desired_loa_half_width must be positive.")

    z = z_for_confidence(confidence)
    n = math.ceil((z**2 * 3 * assumed_sd_diff**2) / desired_loa_half_width**2)
    return BlandAltmanSampleSize(
        n=max(n, 2), assumed_sd_diff=assumed_sd_diff, desired_loa_half_width=desired_loa_half_width, confidence=confidence
    )


@dataclass(frozen=True)
class ProportionPrecisionSampleSize:
    n: int
    assumed_proportion: float
    desired_margin: float
    confidence: float


def proportion_precision_sample_size(
    assumed_proportion: float, desired_margin: float, confidence: float = 0.95
) -> ProportionPrecisionSampleSize:
    """
    Minimum events to estimate a proportion (e.g. sensitivity or
    specificity for a predefined unsafe-movement event, TRD 3.2 Study B)
    within +/- `desired_margin`, given an assumed true proportion.

    Standard normal-approximation formula: n = z^2 * p * (1-p) / d^2.
    """
    if not 0 < assumed_proportion < 1:
        raise ValueError("assumed_proportion must be strictly between 0 and 1.")
    if desired_margin <= 0:
        raise ValueError("desired_margin must be positive.")

    z = z_for_confidence(confidence)
    n = math.ceil((z**2 * assumed_proportion * (1 - assumed_proportion)) / desired_margin**2)
    return ProportionPrecisionSampleSize(
        n=max(n, 1), assumed_proportion=assumed_proportion, desired_margin=desired_margin, confidence=confidence
    )


@dataclass(frozen=True)
class SensitivityStudySampleSize:
    positive_events_needed: int
    negative_events_needed: int
    estimated_sessions_needed: int
    assumed_event_prevalence_per_session: float


def sensitivity_specificity_study_sample_size(
    assumed_sensitivity: float,
    assumed_specificity: float,
    desired_margin: float,
    assumed_event_prevalence_per_session: float,
    confidence: float = 0.95,
) -> SensitivityStudySampleSize:
    """
    Turns separate sensitivity/specificity precision targets (TRD 3.2 Study
    B) into an estimated number of study sessions, given an assumed rate of
    the predefined unsafe-movement event per session (from a pilot or prior
    literature - not computed here). `estimated_sessions_needed` is a
    planning estimate, not a guarantee - actual event rates vary.
    """
    if not 0 < assumed_event_prevalence_per_session <= 1:
        raise ValueError("assumed_event_prevalence_per_session must be in (0, 1].")

    positive = proportion_precision_sample_size(assumed_sensitivity, desired_margin, confidence)
    negative = proportion_precision_sample_size(assumed_specificity, desired_margin, confidence)

    estimated_sessions = math.ceil(positive.n / assumed_event_prevalence_per_session)
    return SensitivityStudySampleSize(
        positive_events_needed=positive.n,
        negative_events_needed=negative.n,
        estimated_sessions_needed=estimated_sessions,
        assumed_event_prevalence_per_session=assumed_event_prevalence_per_session,
    )
