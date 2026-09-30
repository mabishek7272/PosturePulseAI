# Clinical investigation plan (Phase 4 draft)

Source: beAIve TRD §3.2, `docs/study-charter-skeleton.md`, ADR-011. This is an
**engineering-prepared draft structure** for a clinical investigation plan (CIP),
not a submitted or approved protocol. Every section marked **TBD** requires a
named clinical lead, biostatistician, and ethics-board decision before this
document could be submitted anywhere. Do not fill TBD fields speculatively from
this codebase — see `docs/study-charter-skeleton.md`'s own warning, which this
document expands but does not supersede.

## 1. Background and rationale

beAIve estimates joint angles and posture exposure from video, with a
deterministic safety layer (`services/backend-api/src/safety/`,
`services/backend-api/src/policy/`) that never depends on unvalidated ML output
for a safety decision (`docs/adr/005-deterministic-policy-engine.md`). Nothing in
the system has been clinically validated (`docs/claims-and-scope.md`). This
investigation's purpose is to produce that validation evidence, in the
sequence TRD §3.2 specifies (Study A → B → C).

## 2. Objectives

- **Study A (technical feasibility)**: characterize the system's angle-estimation
  accuracy against a reference instrument. Primary measures and their
  computation are fixed (`docs/phase4/statistical-analysis-plan.md`,
  `services/ml-service/app/analysis/technical_feasibility.py`); pass/fail
  thresholds are **TBD (clinical lead + biostatistician)**.
- **Study B (clinical/ergonomic agreement)**: characterize agreement between
  system-flagged events and independent blinded clinical adjudication.
  **TBD**: locked indication(s), adjudicator panel, event definitions.
- **Study C (supervised effectiveness and harm)**: characterize safety and
  effectiveness of clinician-supervised, system-assisted sessions vs.
  standard care. **TBD**: comparator, primary endpoint, oversight group.

## 3. Population

**TBD (clinical lead)** — inclusion/exclusion criteria, target sample size per
study (compute with `services/ml-service/app/analysis/sample_size.py` once an
assumed effect size and desired precision are set), recruitment site(s).

## 4. Study procedures

### 4.1 Enrollment and consent
A `ConsentRecord` (`packages/schemas/src/consent-record.schema.json`) must be
created with the `research_data_export` scope before any session's data may
leave the system as a research export
(`services/backend-api/src/research-export/`) — this is enforced in code, not
just policy. See `docs/phase4/informed-consent-template.md` for the draft ICF
this scope's grant should accompany, and `docs/phase4/data-management-plan.md`
for what the export actually contains.

### 4.2 Session conduct
Standard system flow: `POST /sessions` → `POST /sessions/:id/height` →
`POST /sessions/:id/scale-calibration` → protocol exercises →
symptom-stop available at all times
(`apps/ios-client/Sources/Safety/SymptomStopButton.swift` — **unverified**,
no Swift toolchain in this repo's build environment, see
`apps/ios-client/README.md`). **TBD**: session frequency, duration, setting.

### 4.3 Reference-instrument measurement (Study A only)
**TBD (clinical lead)** — reference instrument (calibrated optical motion
capture or goniometry), synchronization method with system output. Once paired
measurements exist, `services/ml-service/app/analysis/run_technical_feasibility.py`
computes the prespecified statistics from a CSV of paired values — this script
is tested (11 passing tests,
`services/ml-service/tests/test_technical_feasibility.py`) and was verified
against synthetic paired data with a known injected bias, but has never run
against real reference-instrument data.

### 4.4 Safety monitoring
See `docs/phase4/safety-monitoring-plan.md` — real-time symptom-stop
(`SymptomReport`, already implemented and tested), structured adverse-event
documentation (`services/backend-api/src/adverse-events/`, new this pass), and
aggregate oversight metrics (`GET /pilot-metrics`,
`apps/clinician-web`'s Pilot Monitoring page).

## 5. Statistical analysis

See `docs/phase4/statistical-analysis-plan.md`.

## 6. Data management

See `docs/phase4/data-management-plan.md`.

## 7. Ethics and regulatory

- Ethics approval body and consent process: **TBD**. Per TRD §3.2, an existing
  approval for a different beAIve product/protocol must not be presumed to
  cover this distinct posture study.
- Regulatory classification pathway: see
  `docs/regulatory/device-classification-analysis.md` — an analysis, not a
  determination.
- Pre-submission checklist: `docs/phase4/ethics-submission-readiness-checklist.md`.

## 8. Risks and mitigations

See `docs/hazard-analysis.md` and `docs/regulatory/risk-management-file.md` for
the engineering-side hazard controls already implemented and tested. Clinical
risk framing (informed consent language, stopping rules,
benefit/risk statement) is **TBD (clinical lead)**.

## What this document is not

Not an IRB/ethics-board-submitted protocol. Not evidence of any completed
study. Not a claim that any of Study A/B/C has begun. Every TBD above is a
real decision this repository cannot make.
