# Statistical analysis plan (Phase 4 draft)

Source: beAIve TRD §3.2, `docs/study-charter-skeleton.md`, ADR-011. Defines
**how** each study's primary measures are computed — methodology is fixed by
the TRD and implemented as real, tested software; pass/fail thresholds and
population-level decisions remain **TBD (biostatistician + clinical lead)**,
exactly as `docs/study-charter-skeleton.md` already stated. This document does
not itself analyze any data — no real study data exists yet.

## Study A — technical feasibility

**Tooling**: `services/ml-service/app/analysis/technical_feasibility.py`
(11 tests, `services/ml-service/tests/test_technical_feasibility.py`),
runnable via `run_technical_feasibility.py --csv paired_angles.csv`.

| Measure | Method | Implemented | Threshold |
|---|---|---|---|
| Absolute angle error (median, 95th pct) | `compute_angle_error_summary()` — per-pair `|system - reference|`, then median/p95/mean/max | Yes, tested | **TBD** |
| Bland-Altman limits of agreement | `compute_bland_altman()` — bias = mean(system − reference); 95% LoA = bias ± 1.96·SD(diff) | Yes, tested | **TBD** |
| Valid-sample rate | `compute_valid_sample_rate()` — fraction of frames where `QualityGateFlag.state == "supported"` | Yes, tested | **TBD** |

**Sample size**: `services/ml-service/app/analysis/sample_size.py`'s
`bland_altman_sample_size()` computes the minimum paired-sample count to
estimate the LoA within a desired precision, given an assumed SD of
differences (from a pilot or prior literature — **TBD**, not computed here).
Formula and its assumptions are documented in the module's own docstring;
verified against the closed-form calculation in
`services/ml-service/tests/test_sample_size.py`.

**Data requirement not yet met**: this analysis needs real paired
system-vs-reference-instrument measurements. None exist. The tooling is
verified against synthetic data with a known injected bias (which it
correctly recovered) — that is evidence the *tooling* is correct, not
evidence about the *system's* real-world accuracy.

## Study B — clinical/ergonomic agreement

**Method** (TRD §3.2, fixed): sensitivity/specificity for predefined
unsafe-movement events against independent blinded clinical adjudication;
event-level precision/recall; calibration/abstention; subgroup gaps;
test–retest reliability.

**Tooling**: `sample_size.py`'s `sensitivity_specificity_study_sample_size()`
turns an assumed sensitivity/specificity and desired precision into an
estimated session count, given an assumed event rate per session — all three
inputs are **TBD (clinical lead)**.

**Not yet implemented**: the actual sensitivity/specificity computation
itself (comparing system-flagged events to adjudicator labels) needs a real
adjudicated dataset and a locked event definition — TBD per
`docs/phase4/clinical-investigation-plan.md` §2. A straightforward extension
of `technical_feasibility.py`'s pattern (paired CSV in, prespecified
statistic out) once that definition exists.

## Study C — supervised effectiveness and harm

**Method**: comparator and primary endpoint are **TBD (clinical lead)** per
TRD §3.2 and `docs/study-charter-skeleton.md`. Once defined, the same
tooling pattern applies. Real-time safety and adverse-event monitoring for
this study is already implemented — see
`docs/phase4/safety-monitoring-plan.md`.

## Interim/oversight monitoring (all studies)

`GET /pilot-metrics` (`services/backend-api/src/pilot-metrics/`, 5 tests) computes
real aggregate rates (quality-unsupported, cue, escalate-review, symptom-report,
adverse-event) across all sessions, refreshed on every request, with `null`
(not 0) for any rate whose denominator is 0. This is descriptive oversight
tooling, not a study analysis — the oversight group's actual stop criteria are
**TBD**, see `docs/phase4/safety-monitoring-plan.md`.

## Analysis population and handling of missing/unsupported data

Per `docs/claims-and-scope.md` and `services/ml-service/app/quality/quality_gate.py`:
a frame with `QualityGateFlag.state == "unsupported"` contributes no angle
estimate. **TBD (biostatistician)**: whether the technical-feasibility
analysis population is complete-case (unsupported frames excluded entirely,
consistent with `valid_sample_rate` being reported as its own measure) or
handled some other way — this repository does not decide this and the
tooling above does not assume an answer; the caller filters which paired
rows go into the CSV before running `run_technical_feasibility.py`.

## What this document is not

Not a completed analysis. Not a statement that any threshold has been met.
Every number this repository's tooling can produce is a function of whatever
data is fed into it — no real study data exists yet.
