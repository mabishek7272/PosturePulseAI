# Capture-guidance redesign

## Problem

On-device testing surfaced three linked complaints about the battery capture screen
(`GuidedCaptureView.swift` + `BatteryView.swift`):

1. The phone-level gate is both **too strict** (3° tolerance, hard to satisfy handheld)
   and **uncommunicative** (a static "Level the phone" string, no sense of which way to
   correct or how close you are).
2. There is **no distance guidance at all**. `GuidanceEngine` only flags a person as
   `.outOfFrame` when a joint falls outside the frame margin (i.e. too close/badly
   positioned); standing too far away produces no signal, silently degrading estimate
   quality.
3. The camera preview is boxed to a 4:5 rectangle with dead space around it, and
   nothing in the view hierarchy adapts to iPad despite the project already targeting
   it (`TARGETED_DEVICE_FAMILY: "1,2"` in `project.yml`, but zero
   `userInterfaceIdiom`/size-class handling anywhere in `Sources/`).

The skeleton overlay (`SkeletonOverlay.swift`) and the pose pipeline itself
(`BatteryRunner.swift`) are not the problem — pose is set unconditionally every frame
regardless of gate status, confirmed by reading `BatteryRunner.handle(_:)`. The
complaint is entirely about how *guidance* is surfaced, not whether it runs.

## Decisions

### 1. Level gate: loosen tolerance, show direction

- `levelToleranceDegrees` (currently sourced from
  `references/assessment-battery.v0-draft.json`) moves from **3° → 6°**. This is a
  guidance-only threshold (`GuidanceEngine` docstring already says level tolerance
  "for the bubble level only" / guidance, not a measurement input) — it has no effect
  on what gets recorded or measured, only on when recording is allowed to start, so
  loosening it carries no claims-and-scope risk.
- `GuidanceStatus.rollDegrees` already exists; a new `pitchDegrees` is added alongside
  it so the toast can show vertical tilt too, not just roll.
- The toast's tilt icon rotates live toward level and the text names the correction
  direction (`"Tilt right"`, `"Tilt forward"`, etc.) rather than a flat
  `"Level the phone"`.

### 2. Distance: LiDAR where available, frame-fill heuristic otherwise

- A new `DepthCapability` check at capture-session setup:
  `AVCaptureDevice.default(.builtInLiDARDepthCamera, for: .depthData, position: .back) != nil`.
  Devices with LiDAR (iPhone 12 Pro and later Pro/Pro Max models) get a depth sample
  each guidance frame for a precise too-close/too-far read. The test device (iPhone
  XR) has no LiDAR and exercises the fallback path, so both paths must work from day
  one, not be stubbed.
- Fallback: a new frame-fill heuristic in `GuidanceEngine` — compare head-to-ankle
  span (already computed for stillness tracking) against `imageSize.height`. Below a
  threshold fraction → new `GuidanceIssue.tooFar` case (`"Come a bit closer"`). This
  is a genuinely new signal; today there is none for "too far but still fully framed."
- `GuidanceIssue` priority order gains `.tooFar` directly after `.outOfFrame` (framing
  problems still outrank distance, distance outranks view/stillness).

### 3. Guidance surfaced as a non-blocking top toast

- Replaces the old `LevelIndicator` bubble and the implicit "guidance text takes over
  the screen" behavior.
- Position: a single-line banner under the status row (view name / recording dot),
  per the approved mockup — icon + short phrase, one message at a time, following the
  existing `GuidanceIssue` priority order so only the single most-important issue
  shows.
- Message text per issue (replacing today's `prompt(for:)` strings where they changed):
  - `.cameraNotLevel` → directional tilt text + rotating icon (see §1)
  - `.tooFar` (new) → `"Come a bit closer"`, 🔍 icon
  - `.outOfFrame` → `"Step back a little"`, ↔️ icon
  - `.noPerson` → `"Step into the frame"`, unchanged
  - `.wrongView` → unchanged per-view text
  - `.moving` → `"Hold still"`, unchanged
- Non-blocking: the toast never covers the skeleton or the hold-ring; recording still
  only starts once `issues.isEmpty` (unchanged gate logic), but the person can see
  their own skeleton and framing brackets the whole time instead of a blocked screen.

### 4. Full uncropped camera preview, proportionally sized

- The boxed 4:5 preview is replaced with the full, uncropped camera frame filling
  nearly the whole screen (thin dark margin only — nothing the pipeline sees is ever
  cropped from view, matching the approved mockup's option B).
- Built with `GeometryReader`-relative sizing, the same pattern already used in
  `ModeChooserView.swift`'s `pager`, rather than fixed point dimensions — this is what
  makes it scale reasonably on iPad without a bespoke iPad layout. A true
  iPad-optimized (e.g. multi-column) layout is explicitly out of scope for this spec.

## Out of scope

- A dedicated iPad layout beyond proportional scaling (no multi-column/split view).
- Any change to what gets recorded, measured, or how quality gates affect the
  **analysis** pipeline (`services/ml-service/app/quality`) — this spec only touches
  on-device, pre-recording guidance UI.
- The mode-chooser swipe-page restyle and the patient-mode immediate-report design
  (separate specs, next in the "fix all one by one" sequence).

## Files touched (expected)

- `Sources/Assessment/GuidanceEngine.swift` — tolerance constant, `pitchDegrees` on
  `GuidanceStatus`, `.tooFar` issue + frame-fill heuristic, updated `prompt(for:)` text.
- `Sources/Capture/` — new `DepthCapability`/LiDAR probe, wired into session setup.
- `Sources/Session/GuidedCaptureView.swift` — remove `LevelIndicator`, add the new
  top-toast component, restyle the preview container to full-bleed/proportional.
- `Sources/Session/BatteryView.swift` — adjust preview framing if needed (unlikely to
  change; `SkeletonOverlay` already renders over whatever frame it's given).
- `Tests/` — new tests for the `.tooFar` threshold, loosened tolerance, and the toast
  component's pure message-selection logic.

## Testing

- Unit tests in `GuidanceEngineTests` (new or extended) covering: 6° tolerance edge
  cases, `.tooFar` triggering at the frame-fill threshold and clearing above it,
  priority ordering with the new issue inserted.
- Pure-function tests for toast message/icon selection, following the
  `SkeletonOverlayTests.swift` precedent (test the mapping function, not SwiftUI
  rendering).
- Manual on-device verification on the iPhone XR (no LiDAR, exercises the fallback
  path) before considering this done — this whole redesign exists because the earlier
  work wasn't device-verified until late.
