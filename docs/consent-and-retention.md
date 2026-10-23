# Consent and retention design

Source: beAIve PRD §1.6 ("Data minimization"), TRD §2.4. Reference for
`consent-record.schema.json` and `session.schema.json`'s `retentionPolicy`.

## Default posture: minimize by default, opt in for raw video

- **Default retention**: local/on-device processing; only **derived events**
  (pose landmarks, joint angles, quality flags, decision events — never raw pixels)
  are retained server-side, for a bounded number of days
  (`session.retentionPolicy.derivedEvents.retentionDays`).
- **Raw video is opt-in**, with its own explicit, separately-tracked retention
  window (`session.retentionPolicy.rawVideo.optIn` +
  `.retentionDays`). If `optIn` is false, `retentionDays` must be `null` and no
  raw video should ever reach durable storage for that session.

## Consent scope taxonomy (`consent-record.schema.json`)

| Scope | Meaning |
|---|---|
| `derived_events` | Baseline scope; retention of pose/angle/quality/decision events for care delivery. |
| `raw_video` | Explicit opt-in to store raw video beyond the live session, subject to its own retention window. |
| `research_data_export` | Consent to include de-identified derived data in a research/study export (TRD §3.2 studies). |
| `wearable_integration` | Consent to combine data from a connected physiological sensor (PRD §4.6: optional by default; symptom entry stays mandatory regardless). |

A `ConsentRecord` can be revoked (`revokedAt`) or have withdrawal requested
(`withdrawalRequestedAt`); a session created after revocation must not reuse an
expired consent record.

## Subject identity

`subjectPseudoId` on `Session` and `ConsentRecord` is **pseudonymous** — it must
never be a direct identifier (name, national ID, email). Do not add a `name` or
similarly identifying field to any canonical record (sessions, consent records,
events, metric results, reports).

Real-world identity lives in exactly one place: the clinician-only **patient
register** (`docs/adr/017-patient-register.md`). Its name, date of birth and
contact fields are stored only as AES-256-GCM ciphertext under `PATIENT_DATA_KEY`
(required; the register refuses to start without it). The register links a
patient to a `subjectPseudoId` through `PatientSubjectLink`; that link is the
only bridge between an identity and a measurement. Register access is limited to
signed-in clinicians and is audited by action name, never by content. Patient
mode (a person using the app on their own) does not use the register. Withdrawal
and deletion requests for a patient must cover both the register rows and the
sessions reached through the link.

## Clips

Assessment clips (`docs/adr/013-clip-based-analysis.md`) are uploaded to the
server only for analysis. The file is deleted when analysis finishes (or fails
for the last time) unless the session's consent includes the `raw_video` scope;
if the consent cannot be read the file is deleted. What remains is derived data:
metric results in the event log and the landmark series, kept under the
derived-events retention. The sidecar stored with each clip holds timing, gravity
direction and device model, and no identifiers. A patient's device may read the
released report of its own session for 180 days with a `report_reader` token.

## Worker-population access control (deferred, noted here)

PRD §2.4 requires that, for a worker population, managers must not access
individual medical/symptom details absent proper authorization. This repository's
`auth/` module in `services/backend-api` is a minimal role-guard scaffold in this
phase (clinician vs. subject) — a manager/worker role split with that specific
restriction is **not yet implemented** and must be designed before any industrial
deployment (PRD §4.1 Phase 2+ scope), not assumed by omission.

## Security baseline (TRD §2.4, not deepened in this phase)

TLS in transit, encryption at rest, least-privilege roles, tenant isolation. This
phase's `infra/docker-compose.yml` is a local development setup and does not
implement production TLS/encryption-at-rest — that is explicitly out of scope here
and must be addressed before any real subject data is processed.
