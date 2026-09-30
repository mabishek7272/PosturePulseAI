# Safety monitoring plan (Phase 4 draft)

Source: beAIve TRD §2.5, §3.2 ("data safety/clinical oversight group and stop
criteria"), `docs/study-charter-skeleton.md` Study C, ADR-011. Describes the
**mechanics** the software provides for safety monitoring during a pilot —
the oversight group's composition, authority, and actual stop criteria are
**TBD (clinical lead + ethics board)**, same as `docs/study-charter-skeleton.md`
already stated.

## Layer 1 — real-time, in-session (already implemented, Phase 0/1)

A subject-entered `SymptomReport` (`packages/schemas/src/symptom-report.schema.json`)
is **always accepted regardless of concurrent ML confidence** and immediately
transitions the safety state machine
(`services/backend-api/src/safety/safety-state-machine.ts`) to `Pause` or
escalates to `ClinicianReview` — this precedence is enforced in code and
covered by the safety-state-machine test suite. The local symptom-stop path
(`apps/ios-client/Sources/Safety/SymptomStopButton.swift`) completes locally
before any network call, so it isn't blocked by connectivity — **unverified**
in this sandbox (no Swift toolchain).

Quality-gate suppression (`services/ml-service/app/quality/quality_gate.py`)
and the deterministic policy engine
(`services/backend-api/src/policy/policy-engine.service.ts`,
`docs/adr/005-deterministic-policy-engine.md`) mean no safety-relevant cue is
ever driven by unvalidated ML output.

## Layer 2 — structured adverse event documentation (new this pass)

`AdverseEventRecord` (`packages/schemas/src/adverse-event-record.schema.json`,
`services/backend-api/src/adverse-events/`) is the clinician's after-the-fact,
regulatory-grade documentation of an event: causality assessment, ICH-style
seriousness flag, outcome, and a `reportedToEthicsBoardAt` timestamp that
**records** compliance with a reporting-timeline obligation without
**enforcing** it (no deadline is computed or alerted on by this repository —
see the field's own schema comment).

This is deliberately distinct from `SymptomReport` — see the schema's own doc
comment for the full rationale. In short: `SymptomReport` is real-time and
subject-entered; `AdverseEventRecord` is after-the-fact and clinician-authored,
and only exists in a study context.

**API**: `POST /adverse-events` (create), `GET /adverse-events`
(list, `?seriousOnly=true` filter), `POST /adverse-events/:id/reported-to-ethics-board`.
All clinician-only, all audit-logged (`docs/adr/010-clinician-authentication.md`).
Read-only view: `apps/clinician-web`'s Adverse Events page.

**TBD (clinical lead + ethics board)**: the actual reporting-timeline
obligation (e.g. "serious + related events reported within 24 hours"), who
is authorized to mark `reportedToEthicsBoardAt`, and what happens if that
timeline is missed — none of this is a software decision.

## Layer 3 — aggregate oversight metrics (new this pass)

`GET /pilot-metrics` (`services/backend-api/src/pilot-metrics/`) computes, on
every request, across all sessions:

- Session count by safety-FSM state
- Quality-gate unsupported rate
- Decision-action breakdown (cue / escalate_review / measurement_unavailable
  / no_action rates)
- Symptom-report rate per session
- Adverse-event count, serious-adverse-event count, rate per session

Every rate is `null` (never `0`) when its denominator is 0 — "no data yet" is
never presented as "measured and found to be zero" (5 tests,
`services/backend-api/src/pilot-metrics/pilot-metrics.service.spec.ts`).
Read-only view: `apps/clinician-web`'s Pilot Monitoring page, reachable by any
logged-in clinician.

**This is descriptive, not a stopping mechanism.** No threshold in this
repository triggers an automatic pause of the study, recruitment hold, or
alert. That is deliberate: an automatic stop-rule is a clinical/statistical
decision (what rate, over what window, with what false-alarm tolerance)
this repository does not make. The oversight group is expected to review
these metrics against **TBD (clinical lead)** prespecified stop criteria.

## Composition and authority of the oversight group

**TBD (clinical lead)** — per `docs/study-charter-skeleton.md`: "Data
safety/clinical oversight group composition and stop criteria." This
document adds no answer, only the tooling that group would use once it
exists.

## What this document is not

Not a claim that a data safety monitoring board exists, has met, or has set
any stop criterion. Not a claim that any adverse event has occurred or been
handled under this process — `POST /adverse-events` has been exercised only
with synthetic test data in this repository's own verification.
