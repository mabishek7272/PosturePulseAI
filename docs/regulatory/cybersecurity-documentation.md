# Cybersecurity documentation (draft)

Source: ADR-011; addresses the premarket cybersecurity documentation
expectation common to FDA guidance, EU MDR Annex I §17.2, and comparable
SaMD frameworks — a threat model and control inventory, not a completed
cybersecurity risk assessment or penetration test.

## Asset inventory

- Subject data: pseudonymous session/event records (Postgres), never raw
  video (structurally absent — see `docs/phase4/data-management-plan.md`).
- Clinician credentials: bcrypt-hashed passwords (`Clinician.passwordHash`),
  JWTs (8h expiry).
- Audit trail: `AuditLogEntry` records — itself a security-relevant asset
  (tampering with it would hide unauthorized access).

## Software bill of materials

`docs/regulatory/sbom/` (ADR-011, `docs/regulatory/sbom-process.md`) — real,
generated CycloneDX SBOMs for all three services, with a documented scoping
caveat on the Python one. **No vulnerability scan has been run against
these** — see the SBOM doc's "what this does not do" section.

## Threat model (STRIDE-lite)

| Threat | Applies to | Current control | Residual risk |
|---|---|---|---|
| **Spoofing** — impersonating a clinician | `apps/clinician-web`'s REST calls | JWT bearer auth, password verified with bcrypt + fixed-time-cost dummy-hash comparison for unknown usernames (`AuthService.login()`) | Token has no server-side revocation — a leaked token is valid until its 8h expiry (ADR-010's own named follow-up) |
| **Spoofing** — impersonating a subject/device | Session creation, frame ingestion, sensor readings | **None** — these routes are open to any caller (ADR-010's explicit scope boundary) | **Unmitigated** — anyone who can reach backend-api can create sessions and post frames/readings under any `subjectPseudoId` they choose |
| **Tampering** — modifying stored records | `Event`, `AuditLogEntry`, `AdverseEvent` tables | Application-level: services expose no update/delete for these (append-only by convention) | **DB-level REVOKE UPDATE/DELETE is not enforced** — a direct DB connection, or a bug in a future code path, could still mutate history (named gap since Phase 0) |
| **Repudiation** — a clinician denying they accessed data | Clinician reads of session/event/exposure data | `AuditLogEntry` records who, what, when for every guarded route (ADR-010) | Audit log itself has no tamper-evidence (no hash chain, no external log shipping) and no retention/export policy (ADR-010's own follow-up) |
| **Information disclosure** — subject data reaching an unauthorized party | REST reads, WebSocket broadcasts, research export | REST: JWT + role gate + audit log. Research export: additionally requires the `research_data_export` consent scope. WebSocket: **no auth at all** (ADR-009/010's explicit, named scope limit) | **Unmitigated on the WebSocket path** — anyone who knows or guesses a `sessionId` can join its live-update room |
| **Denial of service** | Any HTTP/WS endpoint | None implemented — no rate limiting, no request size caps beyond Express defaults | **Unmitigated** |
| **Elevation of privilege** — a `subject`-role token accessing clinician routes | `RolesGuard` | Verified role from a server-signed JWT, checked against `@Roles(...)` per route (ADR-010) | Only one non-subject role (`clinician`) exists — no least-privilege separation within that role (`docs/consent-and-retention.md`'s "Worker-population access control (deferred)" note, still true) |

## Secure development practices in place

- Schema-validated input at every write boundary that matters
  (`getValidator()`/`appendValidated()` — a malformed record is rejected,
  not silently coerced).
- Passwords: bcrypt, 12 salt rounds, never logged or returned in any
  response.
- `JWT_SECRET` read from environment; falls back to a hardcoded,
  **publicly-known-by-reading-this-repository** dev secret with a logged
  warning if unset — acceptable only for a disposable local sandbox, and
  documented as such everywhere it appears (ADR-010, `infra/docker-compose.yml`).

## What is explicitly NOT done (do not assume otherwise)

- No TLS/encryption-at-rest in this phase's local-dev configuration
  (`docs/consent-and-retention.md`'s pre-existing "Security baseline" note,
  still true).
- No dependency vulnerability scanning.
- No penetration testing of any kind.
- No rate limiting or DoS protection.
- No WebSocket authentication.
- No device/subject authentication at all.
- No security incident response plan.

## What this document is not

Not a completed cybersecurity risk assessment. Not a penetration-test
report. Not a claim that the system is secure against any adversary beyond
what the table above states plainly it is and isn't.
