# ADR-012: Session-scoped subject tokens

## Status
Accepted (resolves the first "Still open" item of ADR-010)

## Context
ADR-010 secured the clinician REST surface but left every device/subject-facing
route and the Socket.IO gateway open, pending a subject identity design. The iOS
client also sent hardcoded `subjectPseudoId`/`consentRecordId` placeholders, and
`POST /sessions` never checked the consent record it was given.

## Decision
- No subject accounts. The device generates a random UUID as its
  `subjectPseudoId` (Keychain, this device only) - never derived from identity.
- The subject grants consent in-app (`POST /consent-records`, all four scopes
  offered, `derived_events` required).
- `POST /sessions` requires an active consent record belonging to the same
  `subjectPseudoId` with `derived_events` (and `raw_video` if raw-video
  retention is requested), then returns `{ session, sessionToken }`: a JWT
  `{ sub: subjectPseudoId, sessionId, role: "subject" }` valid for 4 h, signed
  with the same `JWT_SECRET` as clinician tokens.
- `JwtAuthGuard` + `SessionOwnershipGuard` protect every subject-facing route;
  the token must name the session the request targets.
- `SessionGateway` admits a subject token for the requested session or any
  clinician token; clinician-web now sends its JWT on connect.
- **Exception: `POST /symptom-reports` never rejects for auth.** A forged report
  can only pause a session - the safe direction - while rejecting a genuine one
  would leave an unwell subject in an active session (CLAUDE.md rule 2).
  Reports without a valid token for their session are accepted and logged.

## Consequences / still open
- No refresh: a session longer than 4 h loses REST/Socket.IO access (symptom
  reports still work). Revisit when real session lengths are known.
- No revocation list (same as clinician tokens).
- `GET /consent-records/:id` remains unauthenticated.
- Patient access to reports released after the session ends needs a longer-lived
  credential - designed in piece 5 of docs/superpowers/specs/2026-10-01-posture-report-design.md.
- `raw_video` consent is recorded but the app still sends `rawVideo.optIn: false`;
  no raw-video storage exists yet.
