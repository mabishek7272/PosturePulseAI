# ADR-019: Patient self-signup accounts

## Status
Accepted. Supersedes in part ADR-012's "no subject accounts" decision and the
corresponding language in ADR-017 and `docs/consent-and-retention.md`'s
"Subject identity" section (see "What stays true" / "What changes" below).

## Context
This ADR is Part 1 of a four-part login-based redesign ("Patient & Clinician
Accounts"). The redesign needs a persistent patient identity: a returning
patient recognized across visits, scan/report history tied to that identity,
and a real login screen - none of which the per-session, device-local
`subjectPseudoId` from ADR-012 supports. ADR-012 deliberately rejected subject
accounts ("No subject accounts. The device generates a random UUID as its
`subjectPseudoId`... never derived from identity") because nothing at the time
needed a persistent identity and the pseudonymous design was the safer
default. That tradeoff has now been revisited on purpose, with the privacy
cost weighed against the product need, and the result recorded here rather
than left implicit in the code.

## Decision
A patient may now create a persistent account directly: email + password,
hashed with bcrypt at 12 rounds (`PatientAuthService.hashPassword`,
`BCRYPT_SALT_ROUNDS = 12`), minimum password length 12 characters. Login
and signup are `POST /auth/patient/signup` and `POST /auth/patient/login`
(`patient-auth.controller.ts`), both intentionally public routes (no token
exists yet to gate them, mirroring the clinician `/login` route). On success
each issues a JWT with a new role, `"patient"` (`JwtPayload.role`), distinct
from the existing pseudonymous `"subject"` role. `Role` in
`roles.decorator.ts` is now `"clinician" | "subject" | "patient"`.

The existing pseudonymous flow - `subjectPseudoId`, `SubjectAuthService`,
the `"subject"` JWT role, `POST /consent-records`, `POST /sessions` - is
**not removed and not deprecated**. It keeps working exactly as ADR-012
described. Nothing currently depends on the `"subject"`/`"patient"`
distinction collapsing, and no code path in this change touches
`SubjectAuthService` or the subject-token session flow.

## What stays true from ADR-012 / ADR-017 / consent-and-retention.md
- PII (name, date of birth, contact) is still stored only as field-level
  AES-256-GCM ciphertext under `PATIENT_DATA_KEY`, exactly as ADR-017
  specified. This ADR does not touch that encryption scheme.
- Passwords are hashed (bcrypt, 12 rounds), compared in roughly constant time
  (`PatientAuthService.login` compares against a fixed dummy hash when no
  account exists, mirroring `AuthService`'s clinician login), and never
  logged or stored in plain text.
- The only new identifying field this ADR introduces is `Patient.email`
  (plus `Patient.passwordHash`, which is not identifying on its own). It is
  not a new field on the clinician-visible register entry - it belongs to
  the patient's own login row. A self-signup row has `nameEnc: null`,
  `dobEnc: null`, `contactEnc: null`, and `createdBy: null`
  (`prisma/schema.prisma`'s `Patient` model); a clinician-register row (the
  kind ADR-017 describes) has those fields set and `email`/`passwordHash`
  null. The two row shapes occupy the same table but never overlap on the
  same row.
- Self-signup patients are explicitly excluded from the clinician register's
  search. `PatientsService.open()` returns `null` for any row with
  `nameEnc === null || dobEnc === null` before it reaches `search()`'s
  results, with a comment noting this is "correctly excluded... not an
  error" (`services/backend-api/src/patients/patients.service.ts`). A
  clinician cannot find, see, or search a self-signup patient through the
  register this way.
- Identifiers still never enter the event log, sessions, consent records,
  metric results, or reports. This ADR adds no new identifying field to any
  of those records.

## What changes
A patient can now authenticate as a persistent identity (email + password,
`"patient"` role) instead of only through a per-session, device-generated
pseudonym. This is a considered, partial reversal of ADR-012's reasoning:
ADR-012 held that no subject accounts should exist because nothing needed
one and the pseudonymous default was safer; Part 1 of this redesign needs
one (returning-user convenience, scan history, a real login screen), and
that need was weighed against the privacy tradeoff and accepted. The reversal
is partial, not wholesale - see "not removed" above.

## Consequences / explicitly out of scope
- **No password reset and no email verification.** Both are flagged here as
  missing, not silently absent. `EMAIL_PATTERN` in `patient-auth.service.ts`
  is a syntax check only ("a deliberately liberal syntax check... not a
  deliverability check - there's no verification-email flow yet"), so an
  unowned or mistyped address can register. Until a reset flow exists, a
  patient who loses their password loses access to that account with no
  recovery path.
- **The pseudonymous flow is not deleted.** `SubjectAuthService`, the
  `"subject"` role, and the ADR-012 session flow remain exactly as they
  were. Any future cleanup or consolidation of the two patient-identity
  paths is deferred, not decided here.
- **Self-signup patients are not yet linked to anything.** A self-signup
  `Patient` row is not connected to the clinician register (by design, see
  above) and is not yet connected to session creation, consent records, or
  a `subjectPseudoId` - that linkage is Part 2's job, not this one's. A
  self-signup patient today can log in and receive a `"patient"` JWT, but
  nothing downstream yet consumes that token to create or read a session.
- `docs/consent-and-retention.md`'s "Subject identity" section and ADR-017's
  "Patient mode... never touches the register" statement needed adjacent
  notes pointing here; see the amendments made alongside this ADR.
