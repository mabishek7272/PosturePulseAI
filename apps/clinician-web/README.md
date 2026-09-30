# apps/clinician-web

A read-only clinician review dashboard for beAIve sessions: a session queue
(filterable by safety-FSM state), a session detail view (safety state,
scale-calibration status, exposure summary, and the full event timeline)
with live updates over the same Socket.IO gateway `apps/ios-client` uses,
and an audit log of who has looked at what.

This fills a gap that was explicitly deferred in the Phase 2/3 plan: the
exposure/decision/symptom data services/backend-api already computes had no
UI, only a queryable REST API. This app is that UI - nothing more. It does
not write to a session; all mutating actions (clinician-approved resume,
escalation) remain API-only.

## Security - read before pointing this at anything real

Every REST call this app makes requires a clinician login
(`docs/adr/010-clinician-authentication.md`) - there is no self-service
signup; create an account with
`services/backend-api/scripts/seed-clinician.ts` first. **What login does
NOT cover:** live updates over the Socket.IO gateway, and every
device/subject-facing backend-api route (session creation, frame ingestion,
sensor readings, etc.) - those remain open to anyone who can reach
backend-api's origin. See `docs/adr/009-clinician-web-trust-model.md` for
the full picture of what's fixed and what isn't before this touches real
subject data.

The JWT is kept in `sessionStorage` (cleared when the tab closes, never sent
anywhere but this app's own `fetch` calls) - see `src/auth/tokenStore.ts`.

## Running locally

```sh
# from the repo root, once a clinician account exists (see Security above)
npm run web:dev   # proxies to backend-api at http://localhost:3000
```

Point at a different backend-api instance with a `.env` file:

```
VITE_BACKEND_API_URL=http://localhost:3000
```

## Structure

- `src/auth/` - `tokenStore.ts` (the JWT's one source of truth, shared by
  the API client and React state), `AuthContext.tsx` (`useAuth()`),
  `RequireAuth.tsx` (route guard, redirects to `/login`).
- `src/api/` - `client.ts` (REST calls, attaches the bearer token), `socket.ts`
  (Socket.IO connection, same room convention as `apps/ios-client`'s
  `SessionWebSocketClient` - not gated by login, see Security above),
  `types.ts` (hand-kept types mirroring `packages/schemas/src/*.schema.json`
  - see `docs/adr/004-ios-dtos-hand-kept.md` for why hand-keeping is the
  deliberate choice here too, not an oversight).
- `src/components/` - `SafetyStateBadge` (mirrors the safety FSM state
  verbatim - never a derived risk score, see `docs/claims-and-scope.md`),
  `EventTimeline` (renders the append-only event log; every description is
  derived directly from the stored payload).
- `src/pages/` - `SessionQueuePage` (the review queue), `SessionDetailPage`
  (per-session view with live updates), `AuditLogPage` (who read what,
  when - `docs/adr/010-clinician-authentication.md`'s named follow-up,
  now implemented).

## Testing

```sh
npm run web:test   # from the repo root (vitest)
npm run web:build  # from the repo root (tsc -b && vite build)
```
