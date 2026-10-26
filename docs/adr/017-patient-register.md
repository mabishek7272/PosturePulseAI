# ADR-017: Clinician-only patient register

## Status
Accepted (M1). Updates the "Subject identity" section of
`docs/consent-and-retention.md`.

## Context
Clinic mode needs to attach a session to a named patient so a clinician can find
the right person. Everything in the measurement path (sessions, consent records,
events, reports) is pseudonymous by design and must stay so.

## Decision
- A separate register holds `Patient` rows (name, date of birth, optional
  contact) and `PatientSubjectLink` rows (patient to `subjectPseudoId`, unique
  per subject id). Identifying fields are stored only as AES-256-GCM ciphertext:
  one random 96-bit IV per value, the field name bound as additional data, format
  `v1.<iv>.<tag>.<ciphertext>`.
- The key is `PATIENT_DATA_KEY` (32 random bytes, base64). It is required: the
  register module refuses to start without a valid key. The key lives in
  `infra/.env` on the host (mode 600) and should be backed up apart from the
  database; losing it makes the register unreadable. Rotating it needs a
  re-encryption job that does not exist yet.
- Routes are clinician-only and audited by action name only (create, search,
  link, list sessions); the audit log never receives an identifier.
  - `POST /patients`, `GET /patients?q=` (rows are decrypted, then filtered by
    name or contact, at most 200 returned), `POST /patients/:id/link`,
    `GET /patients/:id/sessions`.
- Identifiers never enter the event log, sessions, consent records, metric
  results or reports. The link row is the only bridge, and it holds the
  pseudonymous id, not an identifier.
- A `subjectPseudoId` can belong to one patient; linking requires that a session
  for it exists.

## Consequences
- Search scans the whole register in memory. That is fine for one clinic; a
  blind index would be needed for a large register.
- A database dump alone does not reveal patients; a dump plus the key does.
- Patient mode (no clinician) never touches the register. **Note (ADR-019):**
  self-signup patient accounts (email + password, `"patient"` JWT role) are a
  separate, parallel identity from the clinician-only register this ADR
  describes. A self-signup patient has no register entry - `nameEnc`/`dobEnc`
  are null on that row - unless a clinician separately adds one; `open()`
  explicitly excludes null-`nameEnc`/`dobEnc` rows from `search()`, so a
  self-signup patient cannot be found through the register. See
  `docs/adr/019-patient-self-signup.md`.
