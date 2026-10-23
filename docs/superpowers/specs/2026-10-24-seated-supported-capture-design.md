# Seated / supported-standing capture mode — design

Status: approved (brainstormed interactively with visual-companion mockups) · 2026-10-24

## 1. Goal

Today the static battery assumes the subject can stand unsupported (`references/assessment-battery.v0-draft.json`'s
steps all say "Stand tall and relaxed..."). Someone who can't — a wheelchair user, someone who needs a rail or
a walker or another person's support — currently has no real path through the product: the standing-only
instructions don't apply to them, and several of the standing metrics are *defined relative to the ankle*
(the plumb-line offsets, lateral body shift) or assume a straight weight-bearing leg (knee alignment, knee
extension), so even if they were somehow captured in a seated frame the numbers wouldn't mean what the report
would imply they mean.

This adds a real, clinically-honest seated/supported-standing capture path: new battery variants, metrics that
still mean something in that position, and metrics that explicitly don't — surfaced the same honest way the
existing standing battery already surfaces what it can't measure at all.

## 2. Decisions (from the brainstorm)

| Topic | Decision |
|---|---|
| Scope | A real alternate capture mode (not just a "could not complete" exclusion), covering both wheelchair/seated and standing-with-support. Bigger lift than a UI change — this is module-sized, same weight class as a future M2/M3 milestone. |
| Metric approach | **Re-anchor to the pelvis, exclude what doesn't transfer.** `static.head_lateral_tilt`, `shoulder_line_tilt`, `hip_line_tilt`, `trunk_lateral_lean`, `trunk_inclination`, `head_shoulder_angle` are already defined relative to the head/shoulder/hip landmarks, not the ankle or a straight leg — they carry over unchanged. `plumb_offset_*` (ankle-anchored), `lateral_body_shift` (ankle-anchored), `knee_frontal_alignment` and `knee_extension` (assume a straight weight-bearing leg) are **excluded** for seated/supported sessions, disclosed with a reason, not silently dropped or computed anyway. |
| Mode selection | A screening question right after the mode chooser (Clinic mode only — see below): "Will you be standing for this assessment?" → standing unsupported / seated / standing with support. Answered once, up front, same place consent already happens. |
| Availability | **Clinic mode only for v1.** A clinician present can help with camera framing and the wheelchair/support setup, and can judge on the spot if something isn't working. Patient mode (fully self-guided) is deferred — self-guided setup for someone who already has mobility needs is a real additional risk worth not taking on in v1. |
| Reference ranges | Same draft/unreviewed status as every other reference range in this product (CLAUDE.md rule 1) — `status: "draft"`, no `clinicallyValidated: true` until a clinical lead signs off, same as today. The metrics that transfer keep a *plausible* claim to the existing geometric 0° definitions (a level shoulder line is level regardless of standing or seated) but that claim itself is clinical judgment this spec does not make unilaterally — flagged for clinical-lead review before the reference file ships as anything but fully draft. |

## 3. Data model — no schema changes needed

This was the first thing checked before designing anything further, and it's good news: `Session.protocolId`
(`packages/schemas/src/session.schema.json`) is already a free-form string, not an enum, and the iOS client
already fetches the battery *before* creating the session (`RootView.swift`'s `prepare()`:
`BatteryClient().fetch()` first, then `SessionsClient().create(..., protocolId: "assessment-battery", ...)`).
So a capture context is just a different `protocolId` string and a different battery file — no new schema, no
new field, no migration.

- **`services/backend-api/src/battery/battery.service.ts`** currently loads one hardcoded file
  (`BATTERY_FILE = "assessment-battery.v0-draft.json"`) at boot. It needs to load **three** files at boot
  (standing — unchanged, seated, supported-standing), each independently validated against the *same*
  `assessment-battery` schema (no schema change), keyed by context.
- **`services/backend-api/src/battery/battery.controller.ts`**'s `GET /assessment-battery` gains an optional
  query param (e.g. `?context=seated|supported_standing`, default `standing` for exact backward compatibility
  with today's behavior and any already-shipped client).
- **iOS `BatteryClient.fetch()`** gains a `captureContext` parameter, threaded from the new screening-question
  answer through to the request and then into the `protocolId` passed to `SessionsClient().create(...)` (e.g.
  `"assessment-battery-seated"` / `"assessment-battery-supported-standing"`) so the session record itself
  honestly records which battery variant produced it.

## 4. New reference data files

- `references/assessment-battery-seated.v0-draft.json` and `references/assessment-battery-supported-standing.v0-draft.json`
  — same shape as the existing file, reusing `anterior`/`left_lateral`/`right_lateral` views (the camera
  framing is still front/side, only the subject's position changes), with:
  - Rewritten `instruction` text per step ("Sit facing the camera, as upright as is comfortable..." /
    "Stand facing the camera, holding the rail/your support...").
  - `metricKeys` limited to the metrics that transfer (§2). `plumb_offset_*`, `lateral_body_shift`,
    `knee_frontal_alignment`, `knee_extension` are simply not listed — no `MetricResult` is ever requested for
    them in these sessions, the same mechanism that already keeps the catalog's `notMeasurable` entries (like
    Q-angle) out of a normal report.
- A new **disclosure list** (shape mirrors `catalog.notMeasurable`: `metricKey`, `label`, `reason`,
  `whatWouldBeNeeded`) for *this capture mode specifically* — distinct from the catalog's permanent
  not-measurable set, which is honest about things no session can ever measure. This is honest about things
  *this session* didn't measure *because of how it was captured*, e.g.: `"static.knee_frontal_alignment"` →
  `"Knee alignment is assessed against a straight, weight-bearing leg; not meaningful for a seated or
  supported position."` Lives alongside the new battery files (same JSON, a new top-level field) or as a
  small sibling file — implementation detail for the plan, not a product decision.
- **No new ML metric code.** The metrics that transfer are computed by the exact same functions already in
  `services/ml-service/app/metrics/static_metrics.py` — geometry relative to shoulder/hip/head landmarks
  doesn't care whether the legs are standing, seated, or supported. The only ml-service-side change is that
  these battery files' `metricKeys` lists simply don't request the excluded ones.

## 5. Report builder changes

`buildReport()` (`services/backend-api/src/reports/report-builder.ts`) needs to surface the new disclosure
list the same honest way it already surfaces `catalog.notMeasurable` — likely a second array alongside
`notMeasurable` (e.g. `notAssessedInThisCaptureMode`), rendered by `AssessmentReportView` as its own labeled
section ("Not assessed in this capture mode" vs. the existing "Not measured by this system"), so a reader
never confuses "this system can never measure this" with "this particular session's position meant this
wasn't assessed." Exact wording is content work for the implementation plan, not resolved here — it must pass
the same `assertClean()` banned-phrase check as everything else.

## 6. UI flow

1. Mode chooser (Clinic mode selected) →
2. **New: screening question**, Neon-Clinical-styled to match the rest of onboarding (dark background, glowing
   selected state, custom line-icon per option — standing/seated/supported figures), *not* the capture
   screen's pulsing energy — this is a real decision point, kept calm in motion even though it's visually
   bold. Three options: standing unsupported / seated / standing with support. A short note under the options
   states plainly that some measurements won't be assessed and the report will say which and why.
3. → Battery fetch with the chosen context → capture flow, instructions pulled from the context-specific
   battery file → report, with the new disclosure section when applicable.

Patient mode's flow is **entirely unchanged** — the screening question only appears in the Clinic-mode branch
for v1 (§2).

## 7. What's explicitly deferred, not decided here

- **Patient (self-guided) mode support** — needs its own safety/usability review before it's offered.
- **Full-parity metrics** (a real seated/supported knee or footrest-alignment metric) — a clinical-design
  question about what's even meaningful to measure in that position, not something this spec invents.
  `docs/hazard-analysis.md` HZ-08 (cohort performance gap, mobility named explicitly) stays open regardless.
- **Clinical sign-off** that the existing geometric 0° reference definitions validly apply unchanged to the
  transferred metrics in a seated/supported position — plausible, not decided; the reference file ships no
  more "validated" than any other draft reference in this product.

## 8. Testing

- `battery.service.spec.ts` / `battery.controller` tests for loading and serving all three battery variants,
  and that an unrecognized `context` value fails loudly rather than silently falling back.
- A test that the seated/supported battery files validate against the existing `assessment-battery` schema
  with zero schema changes.
- `report-builder.spec.ts`: a session built from a seated/supported battery produces rows only for the
  metrics that battery's `metricKeys` lists, and the new disclosure section appears with the right reasons.
- iOS: a test that the screening-question answer is threaded through to the right `protocolId` on session
  creation, and a `-designPreview` case for the new screening screen.
- `npm run lint:claims` must stay clean on the new battery files, disclosure copy and iOS strings.

## 9. Order of work

1. Write the two new battery JSON files + disclosure list; validate against the existing schema (no code yet).
2. `BatteryService`/`BatteryController` multi-context loading, test-first.
3. `report-builder.ts` disclosure-section support, test-first.
4. iOS: screening-question screen (Neon-Clinical styled, per the approved mockup), `BatteryClient`/
   `SessionsClient` context threading, `-designPreview` case.
5. `AssessmentReportView` renders the new disclosure section.
6. Full verification pass: backend jest, ml-service pytest (unaffected, but run anyway since no code there
   should have changed — a good sanity check that nothing leaked in), `lint:claims`, iOS build to device.
