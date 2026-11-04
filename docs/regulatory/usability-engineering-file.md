# Usability engineering file (IEC 62366-structured skeleton)

Source: ADR-011. A skeleton for the use-related risk analysis and formative
evaluation IEC 62366 requires — the structure and the real UI elements that
exist to mitigate use error, not a completed usability engineering process
(that needs actual formative and summative evaluation with real users, which
this repository cannot run).

## Intended users, use environment, user interface

- **Users**: clinicians (supervising `clinic_supervised` or reviewing
  `home_rehab` sessions via `apps/clinician-web`) and subjects (performing
  exercises via `apps/mobile`) — see `docs/intended-use-matrix.md` for
  the (draft, unapproved) deployment-context definitions.
- **Use environment**: clinic (supervised) or home (unsupervised in the
  moment) — `docs/intended-use-matrix.md`.
- **User interface elements identified as use-safety-relevant**:

| UI element | Use-related risk it addresses | Where |
|---|---|---|
| `SymptomStop` | Delayed or failed stop during an adverse symptom | `apps/mobile/src/components/SymptomStop.tsx` + `src/api/symptoms.ts` — local-first: `onStop()` halts the recording synchronously on press, before the sheet opens and before any network call, and the report that follows is skippable. Mounted on both capture paths. The stop latches recording off, so the shutter is not offered again to a patient who has just reported a symptom. `src/api/symptoms.test.ts` covers the retry, the no-token path and the refusal to route a 401 into the logout handler |
| "Measurement unavailable" quality banner | User trusting an estimate the system itself flagged as unsupported | `apps/mobile/src/lib/results.ts` (surfaces `unsupported` / `not_measurable` rather than omitting them); mirrored in `apps/clinician-web`'s `EventTimeline` (never silently omits an unsupported flag) |
| `TwoDFallbackBanner` | User assuming AR-anchored spatial accuracy on a device/tracking state that can't provide it | **NOT IMPLEMENTED in the shipping client.** The SwiftUI file this cited was deleted with `apps/ios-client`, and `apps/mobile` has no equivalent banner: the guided (AR) path is reachable only behind a Settings toggle that defaults to off, so the standard camera path is the default and is not announced as a fallback from anything. The risk is currently mitigated by the AR path not being the default rather than by a named mode, which is weaker. `apps/mobile/src/capture/ar-jig-copy.ts` does surface `tracking_unavailable` / `tracking_limited` as blockers while the AR path is in use, but that gates RECORDING, it does not tell the user which accuracy regime they are in |
| `SafetyStateBadge` | Clinician misreading a session's safety state as a clinical severity score | `apps/clinician-web/src/components/SafetyStateBadge.tsx` — deliberately a direct FSM-state mirror, never a derived score |
| Login screen / session expiry redirect | Clinician continuing to act on a session after their own credentials expired, without realizing it | `apps/clinician-web/src/auth/RequireAuth.tsx` — verified live to redirect on 401 |

## Use scenarios and use errors considered

| Scenario | Potential use error | Mitigation | Verification |
|---|---|---|---|
| Subject feels dizzy mid-exercise | Doesn't realize they can stop, or stop is slow | Always-visible stop button, local-first (no network round trip required to halt) | Code-level: `haltLocally()` executes before any network call (`SessionViewModel.swift`) — **unverified**, no Swift toolchain |
| Pose tracking degrades but subject keeps going | Subject/clinician trusts a degraded/absent estimate | Quality gate suppresses output and states why, rather than showing a stale or guessed value | `test_quality_gate.py` |
| Clinician reviews a session on a phone/AR-unsupported device | Assumes spatial features work identically | `TwoDFallbackBanner` names the mode explicitly | Code-level (iOS unverified) |
| Clinician's login session expires mid-review | Continues acting on stale data, unaware they're logged out | 401 clears the token and the route guard redirects to `/login` | Live-verified headless-browser round trip (session summary earlier this pass) |
| Clinician misreads `SafetyState` as a risk score | Over- or under-reacts based on a state label alone | State labels are the FSM's own vocabulary (`Setup`/`Observing`/`Pause`/etc.), not a numeric or color-coded severity scale | `docs/claims-and-scope.md` review; `lint:claims` |

## Formative evaluation

**Not performed.** IEC 62366 formative evaluation requires observing real or
representative users interacting with the actual interface and identifying
use errors empirically — this repository has no access to real users and
the iOS interface has never even been compiled (no Swift toolchain). The
scenarios table above is engineering reasoning about foreseeable use error,
not empirical evaluation.

## Summative evaluation

**Not performed** — requires a finished, testable interface and real or
representative users; neither condition is met.

## What this document is not

Not a completed usability engineering file. Not evidence that any use error
has been empirically ruled out. Not a substitute for real formative/
summative evaluation with actual clinicians and subjects.
