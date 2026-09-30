import math

import pytest

from app.analysis.technical_feasibility import (
    compute_angle_error_summary,
    compute_bland_altman,
    compute_valid_sample_rate,
)


def test_angle_error_summary_on_known_synthetic_pairs():
    system = [10.0, 20.0, 30.0, 40.0, 50.0]
    reference = [11.0, 19.0, 33.0, 40.0, 45.0]
    # abs errors: 1, 1, 3, 0, 5
    summary = compute_angle_error_summary(system, reference)

    assert summary.n == 5
    assert summary.median_abs_error_degrees == 1.0
    assert summary.mean_abs_error_degrees == pytest.approx(2.0)
    assert summary.max_abs_error_degrees == 5.0
    assert summary.p95_abs_error_degrees == pytest.approx(4.6, abs=0.2)


def test_angle_error_summary_zero_error_when_system_matches_reference_exactly():
    values = [10.0, 20.0, 30.0]
    summary = compute_angle_error_summary(values, values)
    assert summary.median_abs_error_degrees == 0.0
    assert summary.mean_abs_error_degrees == 0.0


def test_angle_error_summary_rejects_mismatched_lengths():
    with pytest.raises(ValueError, match="paired 1:1"):
        compute_angle_error_summary([1.0, 2.0], [1.0])


def test_angle_error_summary_rejects_empty_input():
    with pytest.raises(ValueError, match="zero paired samples"):
        compute_angle_error_summary([], [])


def test_bland_altman_zero_bias_and_zero_loa_width_for_identical_measurements():
    values = [10.0, 20.0, 30.0, 40.0]
    result = compute_bland_altman(values, values)
    assert result.bias_degrees == 0.0
    assert result.sd_diff_degrees == 0.0
    assert result.upper_loa_degrees == 0.0
    assert result.lower_loa_degrees == 0.0


def test_bland_altman_detects_a_systematic_bias():
    system = [11.0, 21.0, 31.0, 41.0]
    reference = [10.0, 20.0, 30.0, 40.0]
    result = compute_bland_altman(system, reference)
    assert result.bias_degrees == pytest.approx(1.0)
    assert result.sd_diff_degrees == pytest.approx(0.0, abs=1e-9)
    # Bias with ~zero spread -> tight limits of agreement around the bias.
    assert result.upper_loa_degrees == pytest.approx(1.0, abs=1e-6)
    assert result.lower_loa_degrees == pytest.approx(1.0, abs=1e-6)


def test_bland_altman_single_pair_has_zero_sd_by_convention_not_nan():
    result = compute_bland_altman([15.0], [10.0])
    assert result.n == 1
    assert not math.isnan(result.sd_diff_degrees)
    assert result.sd_diff_degrees == 0.0


def test_bland_altman_rejects_mismatched_lengths():
    with pytest.raises(ValueError, match="paired 1:1"):
        compute_bland_altman([1.0, 2.0, 3.0], [1.0, 2.0])


def test_valid_sample_rate_computes_the_expected_fraction():
    assert compute_valid_sample_rate(100, 87) == pytest.approx(0.87)
    assert compute_valid_sample_rate(4, 4) == 1.0
    assert compute_valid_sample_rate(4, 0) == 0.0


def test_valid_sample_rate_rejects_zero_total_frames():
    with pytest.raises(ValueError, match="zero frames"):
        compute_valid_sample_rate(0, 0)


def test_valid_sample_rate_rejects_valid_frames_exceeding_total():
    with pytest.raises(ValueError, match="between 0 and total_frames"):
        compute_valid_sample_rate(10, 11)
