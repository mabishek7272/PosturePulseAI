"""app/analysis/mdc.py - minimal detectable change that cannot be computed from
the wrong sigma.

The tests are organised around ADR-020 section 7: the formula is trivial, and
the whole value of the module is in what it refuses. Several assertions are
simulations of the failure it exists to prevent, so the reason for each refusal
is a measured number in the suite rather than a sentence in a docstring.
"""
from __future__ import annotations

import inspect
import math
import pathlib

import numpy as np
import pytest

from app.analysis import mdc
from app.analysis.mdc import (
    MIN_INTERVAL_HOURS,
    MIN_SUBJECTS,
    BetweenSessionSEM,
    MDCRefusal,
    is_statistically_significant_change,
    minimal_detectable_change,
    sem_relative_halfwidth,
    z_for_confidence,
)

KEY = "static.shoulder_line_tilt"
METHOD = "mediapipe_2d_image_plane"


def sem(value: float = 1.0, **overrides) -> BetweenSessionSEM:
    kwargs = dict(
        value=value, metric_key=KEY, measurement_method=METHOD, n_subjects=MIN_SUBJECTS, dataset_id="retest-2027-a"
    )
    kwargs.update(overrides)
    return BetweenSessionSEM(**kwargs)


def mdc_of(s: BetweenSessionSEM, **kw) -> float:
    return minimal_detectable_change(s, metric_key=KEY, measurement_method=METHOD, **kw)


def significant(delta: float, s: BetweenSessionSEM, **kw) -> bool:
    return is_statistically_significant_change(delta, s, metric_key=KEY, measurement_method=METHOD, **kw)


def retest(n=60, true_sem=1.0, seed=0, shift=0.0, hours=72.0):
    rng = np.random.default_rng(seed)
    truth = rng.normal(0.0, 3.0, size=n)  # real between-subject spread
    return (
        truth + rng.normal(0.0, true_sem, size=n),
        truth + shift + rng.normal(0.0, true_sem, size=n),
        np.full(n, hours),
    )


# --- the formula -------------------------------------------------------------


def test_mdc95_is_196_times_root_two_times_the_sem():
    assert mdc_of(sem(1.0)) == pytest.approx(1.959964 * math.sqrt(2), rel=1e-5)
    assert mdc_of(sem(2.5)) == pytest.approx(2.5 * 1.959964 * math.sqrt(2), rel=1e-5)


@pytest.mark.parametrize("level,z", [(0.80, 1.2816), (0.90, 1.6449), (0.95, 1.9600), (0.99, 2.5758)])
def test_other_confidence_levels_use_the_right_critical_value(level, z):
    """Agrees with the lookup table `sample_size.py` uses, which exists there only
    to avoid a scipy dependency - this uses the stdlib instead and needs no table
    that fails for a level it does not list."""
    assert z_for_confidence(level) == pytest.approx(z, abs=2e-4)
    assert mdc_of(sem(1.0), confidence_level=level) == pytest.approx(z * math.sqrt(2), abs=3e-4)


def test_an_unlisted_confidence_level_still_works():
    assert z_for_confidence(0.975) == pytest.approx(2.2414, abs=1e-3)


@pytest.mark.parametrize("bad", [0.0, 1.0, -0.1, 1.5])
def test_an_impossible_confidence_level_is_refused(bad):
    with pytest.raises(ValueError):
        z_for_confidence(bad)


def test_the_mdc_equals_196_times_the_sd_of_the_paired_differences():
    """MDC95 = 1.96 * sqrt(2) * SEM = 1.96 * sd(differences): the sqrt(2) in the
    SEM estimator and the sqrt(2) in the MDC cancel. A useful identity, and an
    independent check that both factors are applied once and only once."""
    a, b, h = retest(n=200, true_sem=1.5, seed=3)
    s = BetweenSessionSEM.from_test_retest(
        session_a=a, session_b=b, hours_between=h, metric_key=KEY, measurement_method=METHOD, dataset_id="d"
    )
    assert mdc_of(s) == pytest.approx(z_for_confidence(0.95) * float(np.std(b - a, ddof=1)), rel=1e-9)


# --- the predicate -----------------------------------------------------------


def test_a_change_is_significant_only_when_it_exceeds_the_mdc():
    threshold = mdc_of(sem(1.0))
    assert significant(threshold * 1.01, sem(1.0))
    assert not significant(threshold * 0.99, sem(1.0))


def test_the_boundary_is_strict():
    """A change exactly equal to the threshold is not called detectable."""
    s = sem(1.0)
    assert not significant(mdc_of(s), s)


def test_direction_does_not_matter():
    s = sem(1.0)
    assert significant(5.0, s) and significant(-5.0, s)
    assert not significant(0.5, s) and not significant(-0.5, s)


def test_zero_change_is_never_significant():
    assert not significant(0.0, sem(0.001))


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_a_non_finite_delta_raises_rather_than_answering_false(bad):
    """'Not significant' would be a claim about a change that was never measured."""
    with pytest.raises(ValueError):
        significant(bad, sem(1.0))


def test_a_stricter_confidence_level_raises_the_bar():
    s = sem(1.0)
    delta = mdc_of(s, confidence_level=0.90) * 1.05
    assert significant(delta, s, confidence_level=0.90)
    assert not significant(delta, s, confidence_level=0.99)


# --- ADR-020 section 7: the wrong input is unrepresentable -------------------


@pytest.mark.parametrize("bare", [1.0, 0.2, np.float64(1.0), np.array([1.0]), "1.0", None])
def test_a_bare_number_is_refused_outright(bare):
    """The central refusal. A float cannot say whether it is a between-session
    SEM or a within-clip standard deviation - and an MDC from the latter flags
    ordinary noise as real change. The error names the reason."""
    with pytest.raises(TypeError, match="within-clip"):
        minimal_detectable_change(bare, metric_key=KEY, measurement_method=METHOD)  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="BetweenSessionSEM"):
        is_statistically_significant_change(1.0, bare, metric_key=KEY, measurement_method=METHOD)  # type: ignore[arg-type]


def test_no_parameter_accepts_a_plain_float_sem():
    """Structural, not behavioural: the public functions' SEM parameter is
    annotated with the provenance-carrying type."""
    for fn in (minimal_detectable_change, is_statistically_significant_change):
        annotation = inspect.signature(fn).parameters["sem_between_session"].annotation
        assert annotation in (BetweenSessionSEM, "BetweenSessionSEM")


def test_the_sem_parameter_has_no_default():
    """No fallback value, and so no silent path to a made-up threshold."""
    for fn in (minimal_detectable_change, is_statistically_significant_change):
        assert inspect.signature(fn).parameters["sem_between_session"].default is inspect.Parameter.empty


def test_this_module_cannot_see_a_per_clip_sigma():
    """No import path to the filter residual, the static-metrics model or any
    per-clip quantity. If one appears, this is the test that makes the change a
    decision rather than a convenience."""
    source = pathlib.Path(mdc.__file__).read_text()
    code = "\n".join(l for l in source.splitlines() if l.lstrip().startswith(("import ", "from ")))
    for forbidden in ("filters", "static_metrics", "respiration", "uncertainty3d", "jitter", "backprojection"):
        assert forbidden not in code, f"mdc.py now imports something touching {forbidden}"


def test_nothing_in_the_application_uses_it_yet():
    """No between-session dataset exists, so no value can be supplied and no
    report, comparison or UI should call this. `compare.ts` keeps its combined-
    uncertainty gate, which makes no claim about between-visit reliability."""
    root = pathlib.Path(mdc.__file__).resolve().parents[1]
    users = [
        p.relative_to(root).as_posix()
        for p in root.rglob("*.py")
        if p.name != "mdc.py"
        and ("analysis.mdc" in p.read_text() or "from app.analysis import mdc" in p.read_text())
    ]
    assert users == [], f"{users} now import mdc; confirm a real between-session dataset exists"


def test_a_sem_must_name_its_dataset():
    """Without it, a number is indistinguishable from a within-clip sigma."""
    for blank in ("", "   "):
        with pytest.raises(MDCRefusal, match="dataset"):
            sem(1.0, dataset_id=blank)


@pytest.mark.parametrize("field", ["metric_key", "measurement_method"])
def test_a_sem_must_name_the_metric_and_method(field):
    with pytest.raises(MDCRefusal):
        sem(1.0, **{field: ""})


@pytest.mark.parametrize("n", [1, 5, MIN_SUBJECTS - 1])
def test_too_few_subjects_cannot_mint_a_threshold(n):
    with pytest.raises(MDCRefusal, match="floor"):
        sem(1.0, n_subjects=n)


@pytest.mark.parametrize("bad", [0.0, -1.0, float("nan"), float("inf")])
def test_a_degenerate_sem_is_refused(bad):
    with pytest.raises(MDCRefusal):
        sem(bad)


def test_a_sem_cannot_be_applied_to_another_metric_or_method():
    """Reliability belongs to a (metric, method) pair. A 2D tilt's SEM says
    nothing about a 2.5D one, and pooling them is the mistake ADR-018 exists to
    prevent."""
    s = sem(1.0)
    with pytest.raises(MDCRefusal, match="cannot be applied"):
        minimal_detectable_change(s, metric_key="static.hip_line_tilt", measurement_method=METHOD)
    with pytest.raises(MDCRefusal, match="cannot be applied"):
        minimal_detectable_change(s, metric_key=KEY, measurement_method="mediapipe_2_5d_depth")
    with pytest.raises(MDCRefusal):
        is_statistically_significant_change(9.9, s, metric_key=KEY, measurement_method="clinician_annotated")


# --- the simulation that justifies all of the above --------------------------


def test_a_within_clip_mdc_would_call_most_no_change_pairs_changed():
    """ADR-020 section 7, measured.

    Between-session SEM 2.0 (set-up, clothing, landmark offsets, day-to-day
    variation) against a within-clip sigma of 0.2, a tenth of it. Take pairs of
    scans of someone whose posture has NOT changed: the only difference is the
    between-session noise. An MDC derived from the within-clip sigma flags the
    great majority of them as real change - a false-progression path. The
    correct one flags about 5%."""
    rng = np.random.default_rng(11)
    between_sem, within_sigma = 2.0, 0.2
    deltas = rng.normal(0.0, between_sem * math.sqrt(2), size=20_000)  # no true change

    right = sem(between_sem)
    wrong_threshold = z_for_confidence(0.95) * math.sqrt(2) * within_sigma

    flagged_right = float(np.mean([abs(d) > mdc_of(right) for d in deltas[:4000]]))
    flagged_wrong = float(np.mean(np.abs(deltas) > wrong_threshold))

    assert flagged_right == pytest.approx(0.05, abs=0.02)
    # Analytically 2 * (1 - Phi(0.554 / 2.828)) = 84.5%.
    assert flagged_wrong == pytest.approx(0.845, abs=0.02), f"within-clip MDC flagged {flagged_wrong:.1%}"


# --- estimating the SEM ------------------------------------------------------


def test_the_sem_is_recovered_from_test_retest_data():
    a, b, h = retest(n=400, true_sem=1.0, seed=2)
    s = BetweenSessionSEM.from_test_retest(
        session_a=a, session_b=b, hours_between=h, metric_key=KEY, measurement_method=METHOD, dataset_id="d"
    )
    assert s.value == pytest.approx(1.0, rel=0.08)
    assert s.n_subjects == 400
    assert s.dataset_id == "d"


def test_the_estimate_ignores_real_between_subject_spread():
    """The point of a test-retest design: people differ from each other a lot
    (sd 3 here) and that must not inflate the measurement error (1)."""
    a, b, h = retest(n=300, true_sem=1.0, seed=4)
    assert float(np.std(a)) > 2.5  # large real spread
    s = BetweenSessionSEM.from_test_retest(
        session_a=a, session_b=b, hours_between=h, metric_key=KEY, measurement_method=METHOD, dataset_id="d"
    )
    assert s.value < 1.2


def test_a_constant_shift_between_sessions_does_not_change_the_sem():
    """The estimator measures RANDOM error. A systematic shift (a learning
    effect, a changed set-up) is a different thing to look for and is not folded
    in - documented rather than silently absorbed."""
    base = BetweenSessionSEM.from_test_retest(
        session_a=retest(seed=5)[0], session_b=retest(seed=5)[1], hours_between=retest(seed=5)[2],
        metric_key=KEY, measurement_method=METHOD, dataset_id="d",
    )
    a, b, h = retest(seed=5, shift=4.0)
    shifted = BetweenSessionSEM.from_test_retest(
        session_a=a, session_b=b, hours_between=h, metric_key=KEY, measurement_method=METHOD, dataset_id="d"
    )
    assert shifted.value == pytest.approx(base.value, rel=1e-9)


def test_same_visit_repeats_are_refused_as_test_retest():
    """Two scans of one visit share the static landmark and soft-tissue offsets
    that dominate real error, so they would understate the SEM in exactly the
    way this module exists to prevent."""
    a, b, _ = retest()
    with pytest.raises(MDCRefusal, match="hours apart"):
        BetweenSessionSEM.from_test_retest(
            session_a=a, session_b=b, hours_between=np.full(a.size, 0.5),
            metric_key=KEY, measurement_method=METHOD, dataset_id="d",
        )


def test_one_short_interval_among_many_still_refuses():
    a, b, h = retest()
    h[7] = MIN_INTERVAL_HOURS - 1
    with pytest.raises(MDCRefusal, match="hours apart"):
        BetweenSessionSEM.from_test_retest(
            session_a=a, session_b=b, hours_between=h, metric_key=KEY, measurement_method=METHOD, dataset_id="d"
        )


def test_a_pair_exactly_at_the_minimum_interval_is_accepted():
    a, b, _ = retest()
    BetweenSessionSEM.from_test_retest(
        session_a=a, session_b=b, hours_between=np.full(a.size, MIN_INTERVAL_HOURS),
        metric_key=KEY, measurement_method=METHOD, dataset_id="d",
    )


def test_too_few_pairs_are_refused():
    a, b, h = retest(n=MIN_SUBJECTS - 1)
    with pytest.raises(MDCRefusal, match="floor"):
        BetweenSessionSEM.from_test_retest(
            session_a=a, session_b=b, hours_between=h, metric_key=KEY, measurement_method=METHOD, dataset_id="d"
        )


def test_identical_sessions_are_not_a_reliability_result():
    """Zero spread in the differences means the same number was entered twice."""
    a, _, h = retest()
    with pytest.raises(MDCRefusal, match="zero"):
        BetweenSessionSEM.from_test_retest(
            session_a=a, session_b=a.copy(), hours_between=h, metric_key=KEY, measurement_method=METHOD, dataset_id="d"
        )


def test_mismatched_or_non_finite_data_is_refused():
    a, b, h = retest()
    for bad_b in (b[:-1], np.where(np.arange(b.size) == 3, np.nan, b)):
        with pytest.raises(MDCRefusal):
            BetweenSessionSEM.from_test_retest(
                session_a=a, session_b=bad_b, hours_between=h, metric_key=KEY, measurement_method=METHOD, dataset_id="d"
            )


# --- how well-determined the threshold is ------------------------------------


@pytest.mark.parametrize("n,expected", [(15, 0.37), (30, 0.26), (50, 0.20)])
def test_the_relative_precision_of_the_sem_is_reported(n, expected):
    """At the floor the MDC itself is uncertain by roughly a quarter, which is why
    `relative_halfwidth` exists: a threshold should be shown with how well it is
    known rather than presented as exact."""
    assert sem_relative_halfwidth(n) == pytest.approx(expected, abs=0.02)


def test_the_floor_is_not_pretending_to_be_precise():
    assert sem(1.0, n_subjects=MIN_SUBJECTS).relative_halfwidth > 0.2


def test_a_single_subject_has_no_precision_to_report():
    with pytest.raises(ValueError):
        sem_relative_halfwidth(1)
