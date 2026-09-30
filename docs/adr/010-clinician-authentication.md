# ADR-010: Real clinician authentication for the review-data REST surface

## Status
Accepted (follow-on to ADR-009)

## Context
ADR-009 named a concrete gap: `apps/clinician-web` and the backend-api routes
it calls had no authentication at all, so any caller who could reach
backend-api's origin could read every session's `subjectPseudoId`, safety
state, symptom reports, and exposure data. Separately, Phase 0 had already
left a scaffold for this — `services/backend-api/src/auth/roles.guard.ts`
and `roles.decorator.ts` — but its own doc comment said plainly: "reads an
`x-role` header, no real identity/session verification... do not rely on
this guard for anything beyond local development." No route actually used
`@Roles(...)`, so the guard was wired but inert.

## Decision
Real clinician identity verification replaces the header placeholder:

- A `Clinician` Prisma model (`username`, `bcrypt` `passwordHash`, `role`).
  No self-service signup - accounts are created with
  `services/backend-api/scripts/seed-clinician.ts`, run by whoever operates
  the deployment.
- `POST /auth/login` (`AuthController`/`AuthService`) verifies the password
  with `bcryptjs` and issues a JWT (`@nestjs/jwt`, 8h expiry). A
  fixed-time-cost dummy-hash comparison runs even for an unknown username, so
  a request's timing doesn't reveal whether that username exists.
- `JwtAuthGuard` verifies the `Authorization: Bearer` header and populates
  `request.user`; `RolesGuard` (the same class from Phase 0, now reading
  `request.user.role` instead of a client-supplied header) checks it against
  `@Roles(...)` metadata. Both must be applied together
  (`@UseGuards(JwtAuthGuard, RolesGuard)`) - `RolesGuard` alone checks
  nothing trustworthy without `JwtAuthGuard` having run first.
- `JWT_SECRET` is read from the environment; if unset, a hardcoded fallback
  is used and a warning is logged - acceptable only for a disposable local
  sandbox, never anywhere shared (`infra/docker-compose.yml` follows the same
  convention with an overridable default).

**Scope - what is and isn't behind this guard:** only the REST routes
`apps/clinician-web` actually reads are gated: `GET /sessions`,
`GET /sessions/:id`, `GET /sessions/:id/events`,
`GET /sessions/:id/exposure/{events,summary}`. Every device/subject-facing
route (`POST /sessions`, `.../calibrate`, `.../height`,
`.../scale-calibration`, `.../camera-poses`, `/sensor-readings`,
`/symptom-reports`, `/sessions/:id/frames`, `/sessions/:id/detect-objects`)
is deliberately left open, because those are called by the subject's own
device (iOS client or an equivalent) within their own session, and this
phase has no subject/device identity system to authenticate them against -
building one is a separate, larger design problem (does a session token get
minted at creation? does the subject need an account at all?) that
shouldn't be improvised as a side effect of securing the clinician surface.
**The Socket.IO gateway (`SessionGateway`) is also not gated by this
change** - it is shared by the subject-facing iOS live-update path and the
clinician-facing dashboard live-update path, and gating it naively for one
side would either break the other or require the same subject-identity
design work just deferred above.

## Rationale
Fixing the concretely-named risk (session list/detail/events/exposure
readable by anyone) is worth doing now, in a bounded way, rather than
waiting for a complete identity system covering every actor in the
architecture. Reusing the Phase 0 `RolesGuard`/`@Roles` scaffold instead of
building a parallel mechanism keeps a single role-check code path.

## Follow-up

**Done since this ADR was first written:** audit logging of clinician
access - `AuditLogEntry` (Prisma), `AuditLogService`, `AuditLogInterceptor`
(fires only on routes carrying `@AuditAction(...)`, and only after a
successful response - a request `JwtAuthGuard`/`RolesGuard` already
rejected is never logged as an access), and `GET /audit-log`
(clinician-only, itself audited under `view_audit_log`) record who read
which session and when for every route this ADR gates. `apps/clinician-web`
has a corresponding read-only `/audit-log` page. A logging failure never
blocks the read it's auditing - `AuditLogService.record()` catches and logs
a warning rather than throwing.

**Still open:**
- Gate the Socket.IO gateway - requires first deciding how a subject's
  device authenticates to its own session (a session-scoped token minted at
  `POST /sessions` is the most likely shape, but that's a real design
  decision, not a one-line guard).
- Token revocation / logout (`JwtAuthGuard` only checks expiry; there is no
  server-side revocation list) - acceptable for an 8h-lifetime token in a
  local/trusted deployment, not for anything wider.
- Self-service account management (currently `seed-clinician.ts` only) and
  real least-privilege/tenant-isolation role modeling (PRD 2.4) remain
  out of scope, as `roles.guard.ts`'s own comment already noted.
- The audit log itself has no retention/export policy and no protection
  against a compromised clinician account deleting or forging entries
  (there is no delete path today, but nothing stops one being added later
  without also adding a reason to refuse it).
