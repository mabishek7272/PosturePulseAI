# Patient & clinician accounts (Part 1 of the login-based redesign)

## Context

This is Part 1 of a four-part redesign requested after a UI/flow review: replace the
swipe-based mode chooser with real login, add a per-scan intake form, an overall
scan-percentage indicator, an immediate report + save/history, and an in-app
clinician patient list. Part 1 is the foundation everything else needs: persistent
accounts for both patients and clinicians, reachable from the iOS app itself.

**Decisions already made with the user:**
- Patients self-signup (email + password), not clinic-provisioned.
- The login screen fully replaces the swipe mode chooser (confirmed, no swipe left).
- Clinic login gets the same account-creation foundation, reusing clinician auth.
- Real accounts proceed even though this reverses a deliberate prior privacy
  decision (see below) — the user was shown the tradeoff and chose to proceed.

### This supersedes three existing documents, not just one

Investigation before writing this spec found the privacy reversal is broader than
first flagged:

1. **ADR-012 ("No subject accounts")** — states patient identity is intentionally
   pseudonymous per-session (a random `subjectPseudoId` in Keychain), specifically
   to avoid storing patient login credentials.
2. **`docs/consent-and-retention.md`**, "Subject identity" section — independently
   states `subjectPseudoId` "must" stay pseudonymous and never carry an identifying
   field into sessions/consent-records/events.
3. **ADR-017 ("Clinician-only patient register")** — states patient PII is
   AES-256-GCM encrypted and clinician-only, and explicitly: "Patient mode (no
   clinician) never touches the register."

All three need a new ADR that explicitly supersedes them, not a silent code change.
**`docs/adr/019-patient-self-signup.md`** (next available number) records: why the
product decided persistent patient accounts are now wanted (login-based UX, scan
history, returning-user convenience), what stays true from the old posture (PII
stays field-level encrypted; passwords are hashed, never stored/logged in plain
text), and what changes (a patient can now authenticate with a persistent identity
instead of a per-session pseudonym). Each of the three documents gets a one-line
"superseded by ADR-019" pointer rather than being deleted.

## What this app already has (reuse, don't rebuild)

Investigation found more existing scaffolding than expected:

- **Clinician login already exists in the iOS app**, not just the web dashboard:
  `Sources/Auth/ClinicianSignInView.swift` + `ClinicianAuthClient.swift`. The new
  landing screen's "Clinic Login" option reuses this near-verbatim — restyled to
  match the new landing screen, not rebuilt.
- **A Keychain wrapper already exists**: `Sources/Identity/SubjectIdentityStore.swift`
  wraps Keychain storage for the pseudonymous subject identity. The new
  `PatientAuthClient`'s token storage copies this wrapper's pattern (new file, since
  what it stores — a persistent patient JWT vs. an ephemeral pseudonym — is
  semantically different enough to warrant its own type, not a shared one doing
  double duty).
- **Clinician backend auth is the pattern to mirror**: `POST /auth/login`,
  bcrypt (12 rounds, constant-time dummy-hash compare against unknown usernames),
  JWT payload `{sub, username, role}`, `JwtAuthGuard`/`RolesGuard`/`@Roles()`. Min
  password length 12, enforced where accounts are created.
- **The `Role` type** is one union (`"clinician" | "subject"` today) in
  `services/backend-api/src/auth/roles.decorator.ts`.

## Decisions for this part

### 1. A new `"patient"` role, not a repurposed `"subject"`

The existing `"subject"` role is tightly coupled to the pseudonymous,
session-scoped/report-reader token pair issued by `SubjectAuthService` — its `sub`
claim is a random `subjectPseudoId`, and downstream code may assume that. Rather
than overload it, `Role` becomes `"clinician" | "subject" | "patient"`. The new
`"patient"` role's JWT `sub` claim is the patient's real, persistent `Patient.id`.
This keeps the change additive: existing `"subject"`-gated routes and the
pseudonymous flow are untouched and keep working for anything not yet migrated to
the new login (there is nothing else using the old flow once the iOS app's landing
screen changes, but no backend code is deleted in this part — that's a later
cleanup, out of scope here, so a partially-rolled-out client can't break).

### 2. `Patient` schema gains auth fields

Current (`prisma/schema.prisma:198-206`):
```prisma
model Patient {
  id         String               @id @default(uuid())
  nameEnc    String
  dobEnc     String
  contactEnc String?
  createdBy  String
  createdAt  DateTime             @default(now())
  links      PatientSubjectLink[]
}
```
`nameEnc`/`dobEnc` are `@id`-required today because every existing `Patient` row was
created by a clinician who had already collected that info. Self-signup patients
won't have a name/DOB yet at account-creation time (that's Part 2's intake form,
filled per-scan, not at signup) — demographic data arrives later, not at signup.
New fields, and the two existing required fields become optional:
```prisma
model Patient {
  id           String               @id @default(uuid())
  email        String?              @unique
  passwordHash String?
  nameEnc      String?
  dobEnc       String?
  contactEnc   String?
  createdBy    String?
  createdAt    DateTime             @default(now())
  links        PatientSubjectLink[]
}
```
`createdBy` becomes optional too: it recorded which clinician created the row;
self-signup patients create their own row, so there's no clinician to attribute it
to. Migration: `npx prisma migrate dev --name patient_auth_fields` locally,
`prisma migrate deploy` on deploy (already wired into the container's startup
command per `docs/HANDOFF.md`).

### 3. New endpoints, mirroring the clinician pattern exactly

`services/backend-api/src/auth/` gains:
- `POST /auth/patient/signup` — body `{ email, password }`. Validates email format,
  password ≥ 12 chars (same rule as clinician accounts), checks uniqueness, bcrypt
  (12 rounds) the password, creates a `Patient` row with only `email`/`passwordHash`
  set (everything else `null` until Part 2's intake form fills it in), returns a JWT.
- `POST /auth/patient/login` — body `{ email, password }`. Same constant-time
  dummy-hash-compare pattern as clinician login (never reveal via timing whether an
  email exists). Returns a JWT: `{ sub: patient.id, email, role: "patient" }`.
- Both reuse the existing `JwtAuthGuard`infrastructure for every later route that
  needs `@Roles("patient")`, exactly like clinician routes use `@Roles("clinician")`
  today.

### 4. iOS: new landing screen, patient auth screens, clinician screen reused

- A new `AccountChooserView` replaces `ModeChooserView` as the first screen after
  `SplashView` — two options, "Patient" and "Clinic," each leading to a
  login/signup flow rather than straight into a session.
- `PatientSignUpView` / `PatientSignInView` (new, modeled directly on the existing
  `ClinicianSignInView`'s structure and validation UX, same `NeonTheme` treatment
  as the rest of the app shell): email + password fields, a toggle between sign-up
  and sign-in, inline validation errors (password too short, email malformed,
  email already registered / wrong credentials — using the same
  not-revealing-which-one-is-wrong copy the backend's timing-safe compare implies).
- `ClinicianSignInView` is reused for the "Clinic" option, restyled to match the new
  landing screen's visual language (NeonTheme) if it isn't already — check its
  current styling before assuming a rewrite is needed.
- `PatientAuthClient` (new, mirrors `ClinicianAuthClient`'s shape) + a Keychain
  token store (new type, pattern copied from `SubjectIdentityStore`) persist the
  patient's JWT across launches, so a returning user skips straight past login.
- `RootView` branches: splash → account chooser → (patient session state restored
  from Keychain ? skip to whatever Part 2 lands on : patient/clinic auth flow).

## Out of scope for this part

- The intake form, the scan flow itself, the report page, save/history, and the
  clinician patient-list screen — Parts 2, 3, and 4 respectively. This part ends at
  "a patient or clinician can sign up/log in and the app remembers them" — it does
  not yet do anything with that identity.
- Deleting or migrating the existing pseudonymous `subject` flow — left running,
  unused by the new screens, cleaned up later once nothing references it.
- Password reset / email verification — not requested; flag as a likely Part 1.5
  if the user wants it, but don't build it unasked.

## Testing

- Backend: `AuthService`/`AuthController` tests for `/auth/patient/signup` and
  `/auth/patient/login` — duplicate-email rejection, password-length rejection,
  successful signup returns a usable JWT, login with wrong password fails with the
  same timing/response shape as an unknown email (regression-test the constant-time
  property the way the existing clinician-login tests presumably already do — check
  their pattern first).
- iOS: unit tests for `PatientAuthClient` (request shaping, error mapping) and the
  new Keychain token store (save/load/clear), following `SubjectIdentityStoreTests`
  if one exists as the precedent.
- Manual: sign up a new patient account on-device, force-quit and relaunch to
  confirm the session persists, log in as `dr.ben` via the Clinic option to confirm
  the reused clinician flow still works end-to-end.
