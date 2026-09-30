"""Study A ("technical feasibility") statistics - TRD 3.2, docs/phase4/statistical-analysis-plan.md.

Computes the primary measures the study charter names (absolute angle error
median/95th percentile, Bland-Altman limits of agreement, valid-sample rate)
from paired system-vs-reference-instrument measurements. This module has no
data of its own - it is tooling, ready to run once a real reference
instrument (calibrated optical motion capture or goniometry) produces real
paired data. Every function raises rather than silently degrading on
mismatched, empty, or misaligned input: a corrupted feasibility statistic
would be worse than no statistic, for the same reason a fabricated
measurement is refused everywhere else in this codebase
(docs/claims-and-scope.md).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# The 95% limits-of-agreement multiplier for a Bland-Altman analysis
# (mean difference +/- 1.96 * SD of the differences, assuming approximately
# normally distributed differences - a standard convention, not something
# derived from this codebase's own data).
BLAND_ALTMAN_LOA_MULTIPLIER = 1.96


@dataclass(frozen=True)
class AngleErrorSummary:
    n: int
    median_abs_error_degrees: float
    p95_abs_error_degrees: float
    mean_abs_error_degrees: float
    max_abs_error_degrees: float


@dataclass(frozen=True)
class BlandAltmanResult:
    n: int
    bias_degrees: float
    sd_diff_degrees: float
    upper_loa_degrees: float
    lower_loa_degrees: float


def _validate_paired(system_degrees: list[float], reference_degrees: list[float]) -> tuple[np.ndarray, np.ndarray]:
    if len(system_degrees) != len(reference_degrees):
        raise ValueError(
            f"system_degrees (n={len(system_degrees)}) and reference_degrees "
            f"(n={len(reference_degrees)}) must be paired 1:1 and the same length."
        )
    if len(system_degrees) == 0:
        raise ValueError("Cannot compute a feasibility statistic from zero paired samples.")
    return np.asarray(system_degrees, dtype=float), np.asarray(reference_degrees, dtype=float)


def compute_angle_error_summary(system_degrees: list[float], reference_degrees: list[float]) -> AngleErrorSummary:
    """Absolute angle error median/95th percentile/mean (TRD 3.2 Study A primary measure)."""
    system, reference = _validate_paired(system_degrees, reference_degrees)
    abs_error = np.abs(system - reference)
    return AngleErrorSummary(
        n=len(abs_error),
        median_abs_error_degrees=float(np.median(abs_error)),
        p95_abs_error_degrees=float(np.percentile(abs_error, 95)),
        mean_abs_error_degrees=float(np.mean(abs_error)),
        max_abs_error_degrees=float(np.max(abs_error)),
    )


def compute_bland_altman(system_degrees: list[float], reference_degrees: list[float]) -> BlandAltmanResult:
    """Bland-Altman bias + 95% limits of agreement (TRD 3.2 Study A primary measure)."""
    system, reference = _validate_paired(system_degrees, reference_degrees)
    diff = system - reference
    bias = float(np.mean(diff))
    sd_diff = float(np.std(diff, ddof=1)) if len(diff) > 1 else 0.0
    return BlandAltmanResult(
        n=len(diff),
        bias_degrees=bias,
        sd_diff_degrees=sd_diff,
        upper_loa_degrees=bias + BLAND_ALTMAN_LOA_MULTIPLIER * sd_diff,
        lower_loa_degrees=bias - BLAND_ALTMAN_LOA_MULTIPLIER * sd_diff,
    )


def compute_valid_sample_rate(total_frames: int, valid_frames: int) -> float:
    """Fraction of frames where quality gating reported `supported` (TRD 3.2 Study A primary measure)."""
    if total_frames <= 0:
        raise ValueError("total_frames must be positive - cannot compute a rate from zero frames.")
    if valid_frames < 0 or valid_frames > total_frames:
        raise ValueError(f"valid_frames ({valid_frames}) must be between 0 and total_frames ({total_frames}).")
    return valid_frames / total_frames
