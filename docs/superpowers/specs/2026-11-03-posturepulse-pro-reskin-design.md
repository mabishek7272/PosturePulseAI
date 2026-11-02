# PosturePulse Pro visual reskin — design

> Status: approved by user (scope + claims-handling decisions made via direct questions, recorded below). Supersedes the dark "Neon" theme used by the Expo client's P1 screens.

## Context

A Claude Design handoff bundle (`Posturepulse Pro Mobile App-handoff.zip`, extracted for this spec) contains 12 fully mocked-up screens for the clinician app, in a light violet/white glassmorphism aesthetic, replacing the dark theme P1 shipped with. The user wants the whole thing built, in order, with the design's content rewritten wherever it collides with `docs/claims-and-scope.md`.

This is a visual reskin of 9 already-built screens plus genuinely new functionality for 3 screens (History, Trends, Settings) that P1 never built and whose backing data ranges from "exists already" to "doesn't exist at all."

## Non-negotiable: what changed from the source design, and why

The source design's copy was audited in full against `docs/claims-and-scope.md`. Three categories of content are **not** being implemented as designed. This table is the authoritative record of every substitution — a future implementer must use the right-hand column, never the source HTML's literal strings.

| Screen | Source design said | Built as |
|---|---|---|
| Home | "Mean score 74" | A completion stat only ("6 of 9 today"). No composite number anywhere. |
| Patients list | A bare number per patient row (78, 66, 52...) | Removed. Row shows name, record meta, and appointment time only. |
| Results | "Posture index 78" hero number, "+6 since week 0" | Removed. Results keeps the existing Reference + Position table (already built, already compliant) as the hero content. |
| Trends | Same "Posture index" line chart | Deferred entirely — see Part 3. No index is invented to chart. |
| Home | "Thoracic kyphosis" as a patient's follow-up tag | Removed. Follow-up context is free text the clinician themselves entered (or blank), never a label the app assigns. |
| Results / History | "Mild forward head", "pelvic obliquity 2.3°" as a session's one-line summary | Replaced with the session's existing Position-based summary (e.g. "1 metric outside reference" — a fact about the data, not a diagnosis). |
| Home | AI "daily brief" asserting a cross-patient pattern ("Three of your follow-ups show... worth a cohort note") | Not built. No feature anywhere in this app performs unprompted cross-patient inference. |
| Results | AI card recommending a specific intervention with one-tap "Accept into record" ("Suggest adding single-leg stance work...") | Replaced with the already-scoped P4 AI-drafted-assessment design: composes only from a clinician-approved cited-note library about *this patient's own* measurements, never names a cause, never recommends a protocol unprompted, and export-equals-sign (no separate "Accept" tap that bypasses review). P4 is not yet built, so this card does not appear until it is. |
| Trends | AI "pattern" card asserting causation ("Index gains track adherence with a one-week lag") | Not built. No causal-inference feature exists or is planned. |
| Analysis / Settings | "On-device model · no images leave this phone", "model v9 (on-device)" | Corrected to describe the real pipeline: clips are uploaded and measured server-side. The six-stage analysis copy already built for P1 ("Uploading clips", "Locating body landmarks"...) already says this correctly — kept as-is, restyled only. |
| Analysis | A bare "68%" mid-processing readout | Removed — P1's existing stage-based progress (which stage is active, not a fabricated percent) is kept. |

The two lines of source copy that were already compliant are kept verbatim as the house style for anything AI-adjacent:
- *"Automated landmark analysis, reviewed and signed off by a clinician before release."*
- *"All AI output is a draft. Nothing enters the record without your sign-off."*

## Part 1 — Shared theme

**New file: `apps/mobile/src/theme/colors.ts`.** Today, 32 hex literals are duplicated by hand across 9 screen files with no shared source. This reskin is the forcing function to fix that — every later task references this file, never a literal hex.

```ts
export const colors = {
  // Light surfaces (the new default — replaces #0e0a16 as the app background)
  bg: "#f8f9ff",
  bgDeep: "#eef0fb",
  bgDark: "#17162a", // splash + capture screens only, which stay dark
  surface: "rgba(255,255,255,0.78)",
  surfaceSolid: "#ffffff",

  // Violet accent ramp
  accent100: "#f5f4ff",
  accent200: "#e7e5fe",
  accent300: "#d2cefd",
  accent400: "#b5abfc",
  accent600: "#796cbf",
  accent700: "#5d5294",
  accent800: "#423a6a",
  accent900: "#2b2741",

  // Dark-screen secondary accent (splash + capture only)
  accentDark300: "#d2cefd",
  accentDark400: "#b5afe8",
  accentDark600: "#7972a9",

  // Text
  text: "#161826",
  textMuted: "#75798c",
  textFaint: "#9397ab",
  textOnDark: "#f5f4ff",

  // Borders / hairlines
  hairline: "#e4e7f5",
  hairlineStrong: "#cfd3e5",

  // Status (unchanged from P1 — no new semantics introduced)
  caution: "#ff6b6b",
} as const;

export const gradients = {
  primaryButton: ["#796cbf", "#5d5294"] as const,
  primaryButtonHover: ["#5d5294", "#423a6a"] as const,
  heroCard: ["#2b2741", "#423a6a", "#5d5294"] as const,
};
```

`Screen.tsx`'s background changes from `#0e0a16` to `colors.bgDeep`. The capture and splash-equivalent (there is no splash screen in P1 — login is the entry point) screens keep a dark background intentionally, matching the source design's own choice to keep Capture dark for camera visibility.

## Part 2 — Restyle the 9 existing screens

Visual-only changes. No change to navigation, API calls, validation, or business logic in any of these files. Each screen's existing `StyleSheet.create` is rewritten against the new palette and the source design's layout, keeping every existing behaviour (the back buttons added to Patient/Consent in the last session stay; the responsive `Screen`/`useResponsive` system stays and extends to the new tokens).

- `login.tsx` — glass card, icon mark, "Unlock" button with the sheen animation.
- `permissions.tsx` — the three-item device-access list with the circular check/toggle pattern.
- `home.tsx` — greeting header, hero "next session" card (real data: next upcoming session, not fabricated), two-up stat grid (today's completion count; no "mean score"), "Up next" list.
- `patient.tsx` — search header, filter chips (Today/Active/All — "Flagged" is dropped, since nothing in this app flags a patient), list rows, existing New Patient form restyled in place.
- `consent.tsx` — the three consent bullets, existing consent text (unchanged, claims-reviewed), restyled card.
- `capture.tsx` — stays dark. Visual polish to the overlay only (the instruction card, pose-progress indicator). The skeleton-overlay animation from the source design is **not** added here — live on-device pose guidance is P2 scope, already deferred in the P1 plan, and restyling P1's camera screen must not quietly pull that forward.
- `analysis.tsx` — restyle the six-stage list and ring/progress treatment; copy is unchanged (already compliant).
- `results.tsx` — restyle the metrics table (Reference + Position bars, matching the source design's reference-range bar visual) and the Clinician's assessment section. No hero score.
- `home.tsx` tab bar — the 5-item bottom nav (Home / Patients / Capture-FAB / Trends / Profile) is added here, since it's shared chrome. Only Home, Patients and Capture are real destinations in P1; Trends and Profile route to the new screens built in Part 3 below (Profile → Settings).

## Part 3 — Three new screens

### History — buildable now, real data

**Corrected during planning:** the source design reaches History from the bottom tab bar, not by drilling into one patient — it's a clinician-wide feed, matching clinician-web's own `SessionQueuePage`. Built on `GET /sessions?limit=` (clinician-only, already used by clinician-web), not the per-patient `GET /patients/:id/sessions` this spec originally named. Each row: date, protocol, state chip. No score, no diagnostic label. "Export full record (PDF)" from the source design is **not** built — no PDF export exists anywhere in this stack; cut rather than stubbed with a dead button.

### Trends — deferred, not built this pass

No backend aggregates metric values across a patient's sessions, and the source design's chart is keyed entirely to the composite "posture index" this spec already rejects. Building a real per-metric trend chart (e.g. "head lateral tilt across this patient's last 6 sessions") is possible but needs: a decision on which metrics chart-worthy, a new backend aggregation (or client-side merge of `GET /patients/:id/sessions` + per-session events, which is slow and N+1), and a design for what the chart shows instead of an index. That is new scope, not a restyle, and is being called out rather than built quietly. **The Trends tab routes to a plain "Not available yet" screen for this pass** — no fabricated chart, no placeholder data.

### Settings — buildable, but most toggles describe features that don't exist yet

Audited against what's actually built:

| Source design toggle | Status |
|---|---|
| Auto-capture when steady | Not built (P2: on-device pose guidance). Shown disabled with "Coming soon." |
| Skeleton overlay | Same — P2. Disabled with "Coming soon." |
| Voice notes | Not built, not scoped anywhere. Dropped entirely, not shown. |
| Draft clinical notes (Pulse AI) | P4, not yet built. Shown disabled with "Coming soon." |
| Live capture guidance (Pulse AI) | Conflated with on-device guidance above in the source design; same P2 dependency. Disabled with "Coming soon." |
| Privacy & data retention | No settings-backed retention control exists. Dropped. |
| Lock device / idle timeout | Login screen's existing copy claims "Sessions lock after 10 minutes idle" — **this is not implemented either** and is itself a claims problem (asserts a security behaviour that doesn't exist). Flagged for the implementer to either build a minimal idle-lock (out of scope for this reskin) or remove the claim from the login screen. Recommendation: remove the claim now, build idle-lock as its own small follow-up. |
| Version string | Real version from `app.json`, with no "(on-device)" claim. |

Settings ships as a real screen with real sign-out (already exists) and clinician identity, and every not-yet-built toggle rendered visibly disabled with honest copy — never a toggle that looks live but does nothing silently.

## Part 4 — Idle lock

The login screen's existing claim ("Sessions lock after 10 minutes idle") becomes real rather than being removed.

**Design:** a module-level activity tracker (`apps/mobile/src/auth/idleLock.ts`) records a `lastActivityAt` timestamp, updated by a touch listener at the root layout that observes every touch without intercepting it (`onStartShouldSetResponderCapture` returning `false`). A periodic check (every 30s while the app is active, and once on every `AppState` transition to `active`) compares wall-clock elapsed time against a 10-minute threshold; if exceeded and a clinician token exists, it clears the token and routes to `/login` — reusing the exact mechanism `setUnauthorizedHandler` already uses for a 401, so there is one lock-and-redirect code path, not two.

Checking on `AppState` becoming active (not just the interval) covers the realistic shared-device case: the app is backgrounded, a different person reopens it nine minutes later — the elapsed wall-clock time is still correct even though the interval wasn't ticking while backgrounded.

**Known limitation, stated plainly rather than silently uncovered:** this does not cover the app being fully killed and relaunched — a fresh launch still goes straight to Home if a valid token is in the keychain, regardless of how long the app was closed. Persisting `lastActivityAt` to the keychain alongside the token would close this gap; out of scope for "minimal," noted here so it isn't mistaken for complete coverage later.

## Verification

- `npx jest` and `npx tsc --noEmit` clean after each task, same bar as every P1 task.
- `bash scripts/lint-claims.sh` clean — this is the task that matters most here, given how much copy changed.
- Manual device check: every screen still reachable via the same navigation that worked before (this is a restyle; nothing should newly 404).
- Re-read this spec's substitution table against the final copy in each changed file before calling any task done — the easiest way to regress is to let an implementer "helpfully" restore a closer match to the source HTML's words.
