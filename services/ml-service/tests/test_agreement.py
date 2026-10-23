"""Tests for app.analysis.agreement - each case's expected answer is known by
construction, not just a snapshot of whatever the implementation produces."""
import numpy as np
import pytest

from app.analysis.agreement import StudyAgreementError, compute_agreement
from app.analysis.study_dataset import StudyRow


def make_row(
    subject="s1",
    trial="t1",
    metric="static.trunk_inclination",
    side=None,
    unit="deg",
    system=1.0,
    reference=1.0,
    instrument="universal_goniometer",
    excluded=None,
    line_no=2,
) -> StudyRow:
    return StudyRow(
        line_no=line_no,
        subject_id=subject,
        trial=trial,
        metric_key=metric,
        side=side,
        unit=unit,
        system_value=system,
        reference_value=reference,
        reference_instrument=instrument,
        excluded_reason=excluded,
    )


def test_an_injected_constant_bias_is_recovered():
    rows = [
        make_row(subject=f"s{i}", trial="t1", system=10.0 + 2.0, reference=10.0)
        for i in range(10)
    ]
    [stratum] = compute_agreement(rows)
    assert stratum.bias == pytest.approx(2.0, abs=1e-9)
    assert stratum.sd_diff == pytest.approx(0.0, abs=1e-9)


def test_identical_inputs_give_zero_bias_zero_rmse_and_icc_one():
    rows = [make_row(subject=f"s{i}", trial="t1", system=float(i), reference=float(i)) for i in range(5)]
    [stratum] = compute_agreement(rows)
    assert stratum.bias == pytest.approx(0.0, abs=1e-9)
    assert stratum.rmse == pytest.approx(0.0, abs=1e-9)
    assert stratum.icc == pytest.approx(1.0, abs=1e-9)


def test_a_known_proportional_bias_is_detected():
    # Difference grows linearly with the magnitude being measured: a textbook proportional bias.
    rows = []
    for i, mean_value in enumerate([0.0, 5.0, 10.0, 15.0, 20.0, 25.0, 30.0, 35.0]):
        diff = 0.2 * mean_value
        system = mean_value + diff / 2
        reference = mean_value - diff / 2
        rows.append(make_row(subject=f"s{i}", trial="t1", system=system, reference=reference))
    [stratum] = compute_agreement(rows)
    assert stratum.proportional_bias.detected is True
    assert stratum.proportional_bias.slope > 0


def test_no_proportional_bias_when_the_difference_does_not_track_magnitude():
    rng = np.random.default_rng(0)
    rows = []
    for i, mean_value in enumerate([0.0, 5.0, 10.0, 15.0, 20.0, 25.0, 30.0, 35.0, 1.0, 22.0]):
        diff = float(rng.normal(0.0, 0.01))  # tiny, unrelated to magnitude
        rows.append(make_row(subject=f"s{i}", trial="t1", system=mean_value + diff / 2, reference=mean_value - diff / 2))
    [stratum] = compute_agreement(rows)
    assert stratum.proportional_bias.detected is False


def test_a_sign_flipped_column_raises_the_inversion_warning():
    rng = np.random.default_rng(1)
    rows = []
    for i in range(10):
        reference = float(rng.uniform(-10, 10))
        system = -reference + float(rng.normal(0, 0.01))  # inverted sign convention
        rows.append(make_row(subject=f"s{i}", trial="t1", system=system, reference=reference))
    [stratum] = compute_agreement(rows)
    assert stratum.sign_inversion_suspected is True
    assert stratum.pearson_r < -0.5


def test_a_normal_non_inverted_relationship_does_not_warn():
    rng = np.random.default_rng(2)
    rows = []
    for i in range(10):
        reference = float(rng.uniform(-10, 10))
        system = reference + float(rng.normal(0, 0.01))
        rows.append(make_row(subject=f"s{i}", trial="t1", system=system, reference=reference))
    [stratum] = compute_agreement(rows)
    assert stratum.sign_inversion_suspected is False


def test_unbalanced_trial_counts_give_a_wider_loa_than_naive_pooling():
    # Two subjects measured once each (large, opposite differences); one subject
    # measured many times with near-zero, low-noise differences. Naive pooling
    # (ignore subject grouping entirely) is dominated by the two singletons less
    # than the repeated-measures estimator, which must not let subject C's many
    # near-identical trials shrink the perceived between-subject spread.
    rows = [
        make_row(subject="a", trial="t1", system=5.0, reference=0.0),
        make_row(subject="b", trial="t1", system=-5.0, reference=0.0),
    ]
    rng = np.random.default_rng(3)
    for j in range(10):
        noise = float(rng.normal(0.0, 0.05))
        rows.append(make_row(subject="c", trial=f"t{j}", system=noise, reference=0.0))

    [stratum] = compute_agreement(rows, repeated_measures_method="repeated_measures")
    naive_sd = float(np.std([r.system_value - r.reference_value for r in rows], ddof=1))
    assert stratum.repeated_measures_method == "repeated_measures"
    assert stratum.sd_diff > naive_sd


def test_subject_means_method_is_labelled_and_differs_from_repeated_measures():
    rows = [
        make_row(subject="a", trial="t1", system=5.0, reference=0.0),
        make_row(subject="b", trial="t1", system=-5.0, reference=0.0),
    ]
    rng = np.random.default_rng(4)
    for j in range(10):
        noise = float(rng.normal(0.0, 0.05))
        rows.append(make_row(subject="c", trial=f"t{j}", system=noise, reference=0.0))

    [rm] = compute_agreement(rows, repeated_measures_method="repeated_measures")
    [sm] = compute_agreement(rows, repeated_measures_method="subject_means")
    assert rm.repeated_measures_method == "repeated_measures"
    assert sm.repeated_measures_method == "subject_means"
    assert sm.n_pairs == rm.n_pairs  # same underlying pairs...
    assert sm.sd_diff != pytest.approx(rm.sd_diff)  # ...but a different spread estimate.


def test_excluded_rows_change_the_valid_sample_rate_but_not_the_bias():
    included = [make_row(subject=f"s{i}", trial="t1", system=1.0 + i * 0.01, reference=1.0) for i in range(5)]
    [without_exclusions] = compute_agreement(included)

    excluded_extra = [
        make_row(subject="x1", trial="t1", system=None, reference=None, excluded="pipeline_unsupported"),
        make_row(subject="x2", trial="t1", system=None, reference=None, excluded="missing_subject_specific_scale"),
    ]
    [with_exclusions] = compute_agreement(included + excluded_extra)

    assert with_exclusions.bias == pytest.approx(without_exclusions.bias)
    assert with_exclusions.n_pairs == without_exclusions.n_pairs == 5
    assert with_exclusions.valid_sample_rate == pytest.approx(5 / 7)
    assert without_exclusions.valid_sample_rate == pytest.approx(1.0)


def test_two_reference_instruments_for_one_metric_form_two_strata():
    rows = [
        make_row(subject="s1", trial="t1", instrument="universal_goniometer", system=1.0, reference=1.0),
        make_row(subject="s2", trial="t1", instrument="universal_goniometer", system=2.0, reference=2.0),
        make_row(subject="s1", trial="t1", instrument="digital_inclinometer", system=3.0, reference=3.0),
        make_row(subject="s2", trial="t1", instrument="digital_inclinometer", system=4.0, reference=4.0),
    ]
    strata = compute_agreement(rows)
    assert len(strata) == 2
    assert {s.reference_instrument for s in strata} == {"universal_goniometer", "digital_inclinometer"}


def test_grouping_never_mixes_units_even_across_metrics():
    # static.trunk_inclination is "deg"; static.lateral_body_shift is "percent_stature" - different
    # metric_keys, so they must never land in the same stratum regardless of unit.
    rows = [
        make_row(metric="static.trunk_inclination", unit="deg", system=1.0, reference=1.0, subject="s1"),
        make_row(metric="static.trunk_inclination", unit="deg", system=2.0, reference=2.0, subject="s2"),
        make_row(metric="static.lateral_body_shift", unit="percent_stature", system=1.0, reference=1.0, subject="s1"),
        make_row(metric="static.lateral_body_shift", unit="percent_stature", system=2.0, reference=2.0, subject="s2"),
    ]
    strata = compute_agreement(rows)
    assert len(strata) == 2
    units = {s.metric_key: s.unit for s in strata}
    assert units == {"static.trunk_inclination": "deg", "static.lateral_body_shift": "percent_stature"}


def test_reference_repeatability_uses_subjects_with_repeat_measurements():
    rows = [
        make_row(subject="s1", trial="t1", system=1.0, reference=1.0),
        make_row(subject="s1", trial="t2", system=1.1, reference=1.2),  # repeat reference measurement
        make_row(subject="s2", trial="t1", system=2.0, reference=2.0),  # no repeat
    ]
    [stratum] = compute_agreement(rows)
    rr = stratum.reference_repeatability
    assert rr is not None
    assert rr.n_subjects == 1
    assert rr.n_observations == 2
    assert rr.within_subject_sd > 0


def test_reference_repeatability_is_none_without_any_duplicate_subject():
    rows = [make_row(subject=f"s{i}", trial="t1", system=1.0, reference=1.0) for i in range(3)]
    [stratum] = compute_agreement(rows)
    assert stratum.reference_repeatability is None


def test_a_stratum_with_no_included_rows_raises():
    rows = [make_row(system=None, reference=None, excluded="pipeline_unsupported")]
    with pytest.raises(StudyAgreementError):
        compute_agreement(rows)


def test_threshold_status_is_always_not_set():
    rows = [make_row(subject=f"s{i}", trial="t1") for i in range(3)]
    [stratum] = compute_agreement(rows)
    assert stratum.threshold_status == "not set"
