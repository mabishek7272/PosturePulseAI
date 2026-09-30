# Data management plan (Phase 4 draft)

Source: beAIve PRD §1.6, TRD §2.4, `docs/consent-and-retention.md`, ADR-011.
Operationalizes consent-and-retention.md's design for a study context —
describes what the software actually does; does not itself grant any
approval or decide any retention period.

## Data flow

1. **Consent**: `ConsentRecord` created with the required scopes
   (`derived_events` baseline; `research_data_export` required before any
   export; `raw_video` only if opted in; `wearable_integration` only if a
   sensor is used) — `packages/schemas/src/consent-record.schema.json`.
2. **Collection**: session frames → ml-service (pose/quality/angles) →
   backend-api's append-only `Event` log
   (`services/backend-api/src/events/`). Raw video is never written into
   `Event.payload` by any producer in this codebase — confirmed by reading
   every event-producing module, not merely documented as a rule (see
   `docs/regulatory/risk-management-file.md`'s control for HZ-02/data
   minimization).
3. **Storage**: Postgres, this phase's local-dev configuration
   (`infra/docker-compose.yml`) — **not** production TLS/encryption-at-rest;
   see `docs/consent-and-retention.md`'s existing "Security baseline" section,
   still true, still out of scope here.
4. **Access**: clinician-only, JWT-gated, audit-logged for every read of
   session/event/exposure data (`docs/adr/010-clinician-authentication.md`).
   `GET /audit-log` gives a queryable record of every access.
5. **Research export**: `GET /sessions/:id/research-export`
   (`services/backend-api/src/research-export/`) — refuses to export unless
   the subject's consent record has the `research_data_export` scope active
   (2 tests proving both the refusal and the successful, de-identified
   bundle shape). The bundle contains only `subjectPseudoId` (pseudonymous),
   protocol metadata, and the derived-event log — never `consentRecordId`
   itself, never raw video (structurally absent from the source it reads).
6. **Adverse event data**: `AdverseEventRecord`
   (`services/backend-api/src/adverse-events/`) — its own table, not part of
   the per-session `Event` log, since an event may trace to no specific
   session (docs/phase4/safety-monitoring-plan.md).
7. **Retention**: `Session.retentionPolicy` (`derivedEvents.retentionDays`,
   `rawVideo.optIn`/`retentionDays`) is captured per session at creation.
   **Not yet implemented**: an actual scheduled deletion job enforcing these
   windows — the field is captured and available to query, but nothing in
   this codebase currently purges data when a retention window elapses. This
   is a real gap, not a decided "we don't need this."
8. **Withdrawal**: `ConsentRecord.withdrawalRequestedAt`/`revokedAt` exist
   and are checked by `ConsentService.hasActiveScope()` before any
   consent-gated action (sensor readings, research export). **Not yet
   implemented**: retroactive deletion/anonymization of already-collected
   data on withdrawal — TRD/PRD do not specify this is required beyond
   stopping further collection and access, but a real study's data
   management plan must state this explicitly. **TBD (clinical lead + legal)**.

## De-identification

`subjectPseudoId` is the only subject-linking field ever included in a
research export or shown in `apps/clinician-web`. It is pseudonymous by
design (`docs/consent-and-retention.md`) — mapping it back to a real
identity is explicitly kept outside this codebase's schemas. This document
does not claim the export is anonymized in a regulatory sense (e.g. HIPAA
Safe Harbor or GDPR anonymization) — pseudonymization and anonymization are
different standards, and which one this study needs is **TBD (legal/ethics)**.

## Data quality

Every emitted record carries `provenance` (schema/model/calibration version,
`packages/schemas/src/common.schema.json#/$defs/provenance`) so any exported
data can be traced to exactly the software version that produced it — this
is what makes `docs/regulatory/verification-validation-report.md`'s test
evidence meaningfully connectable to exported study data later.

## What this document is not

Not a data protection impact assessment (DPIA) or equivalent — a real study
handling real subject data needs one, scoped to the actual jurisdiction and
data flows, which is **TBD**. Not a claim that retention windows are
currently enforced (they are captured, not yet enforced — see §7 above).
