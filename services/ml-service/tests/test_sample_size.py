import pytest

from app.analysis.sample_size import (
    bland_altman_sample_size,
    proportion_precision_sample_size,
    sensitivity_specificity_study_sample_size,
    z_for_confidence,
)


def test_z_for_confidence_returns_the_standard_tabulated_values():
    assert z_for_confidence(0.95) == pytest.approx(1.96, abs=0.001)
    assert z_for_confidence(0.99) > z_for_confidence(0.95) > z_for_confidence(0.90)


def test_z_for_confidence_rejects_an_untabulated_level():
    with pytest.raises(ValueError, match="No tabulated z-value"):
        z_for_confidence(0.9123)


def test_bland_altman_sample_size_grows_with_assumed_variability():
    tight_spread = bland_altman_sample_size(assumed_sd_diff=2.0, desired_loa_half_width=1.0)
    wide_spread = bland_altman_sample_size(assumed_sd_diff=6.0, desired_loa_half_width=1.0)
    assert wide_spread.n > tight_spread.n


def test_bland_altman_sample_size_shrinks_with_a_looser_precision_target():
    tight_precision = bland_altman_sample_size(assumed_sd_diff=3.0, desired_loa_half_width=0.5)
    loose_precision = bland_altman_sample_size(assumed_sd_diff=3.0, desired_loa_half_width=2.0)
    assert loose_precision.n < tight_precision.n


def test_bland_altman_sample_size_matches_the_documented_formula():
    # n = ceil(z^2 * 3 * sigma^2 / d^2), z=1.96 for 95% confidence.
    result = bland_altman_sample_size(assumed_sd_diff=3.0, desired_loa_half_width=1.0, confidence=0.95)
    expected = (1.96**2 * 3 * 3.0**2) / 1.0**2
    assert result.n == pytest.approx(expected, abs=1)


def test_bland_altman_sample_size_rejects_nonpositive_inputs():
    with pytest.raises(ValueError, match="positive"):
        bland_altman_sample_size(assumed_sd_diff=0, desired_loa_half_width=1.0)
    with pytest.raises(ValueError, match="positive"):
        bland_altman_sample_size(assumed_sd_diff=1.0, desired_loa_half_width=0)


def test_proportion_precision_sample_size_matches_the_documented_formula():
    result = proportion_precision_sample_size(assumed_proportion=0.8, desired_margin=0.1, confidence=0.95)
    expected = (1.96**2 * 0.8 * 0.2) / 0.1**2
    assert result.n == pytest.approx(expected, abs=1)


def test_proportion_precision_sample_size_is_largest_near_p_equals_half():
    near_half = proportion_precision_sample_size(assumed_proportion=0.5, desired_margin=0.05)
    extreme = proportion_precision_sample_size(assumed_proportion=0.95, desired_margin=0.05)
    assert near_half.n > extreme.n


def test_proportion_precision_sample_size_rejects_out_of_range_proportion():
    with pytest.raises(ValueError, match="strictly between 0 and 1"):
        proportion_precision_sample_size(assumed_proportion=1.0, desired_margin=0.05)
    with pytest.raises(ValueError, match="strictly between 0 and 1"):
        proportion_precision_sample_size(assumed_proportion=0.0, desired_margin=0.05)


def test_sensitivity_specificity_study_translates_events_to_sessions():
    result = sensitivity_specificity_study_sample_size(
        assumed_sensitivity=0.85,
        assumed_specificity=0.90,
        desired_margin=0.1,
        assumed_event_prevalence_per_session=0.2,
    )
    assert result.positive_events_needed > 0
    assert result.negative_events_needed > 0
    # Fewer events per session -> more sessions needed for the same event count.
    assert result.estimated_sessions_needed == pytest.approx(
        result.positive_events_needed / 0.2, abs=1
    )


def test_sensitivity_specificity_study_rejects_invalid_prevalence():
    with pytest.raises(ValueError, match="prevalence"):
        sensitivity_specificity_study_sample_size(
            assumed_sensitivity=0.8, assumed_specificity=0.8, desired_margin=0.1, assumed_event_prevalence_per_session=0
        )
