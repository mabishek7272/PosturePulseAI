# iOS "neon shell" redesign — design

Status: approved (brainstormed interactively with visual-companion mockups) · 2026-10-23, amended same day to
add §9 (report screen)

## 1. Goal

The owner's reaction to the current "clinical instrument on paper" look (`Sources/DesignSystem/Theme.swift`)
on a real device was that it feels flat and unexciting. This spec adds an energetic, animated, "neon" visual
layer to the **app shell** — splash, mode chooser, and the live capture screen — while leaving the report's
own *measurements and wording* exactly as they are. §9 (added after seeing competitor reference screenshots)
extends a **constrained, branded dark treatment** to the report screen's chrome — still never touching a
measured value, a position judgement, or any copy string.

## 2. Scope

**In scope** (new `Sources/DesignSystem/NeonTheme.swift` + three screens):
- A new animated splash screen, shown once per app launch.
- The mode chooser (`Sources/Session/ModeChooserView.swift`), rebuilt as a vertically swipeable, full-bleed
  two-panel view (Clinic / Patient).
- The live capture screen (`Sources/Session/BatteryView.swift` → `GuidedCaptureView`'s `stage` slot), which
  gains an animated 13-joint neon skeleton overlay traced over the camera preview during a hold.

**Explicitly out of scope** — these do not change:
- `apps/clinician-web/src/report/` (the clinician dashboard) — web is a separate audience/brainstorm, see §5.
- Inside `Sources/Report/*` (amended by §9): the *wording* (every copy string in `AssessmentReport.swift`'s
  `introCopy`/`notMeasurableCopy`/`draftReferenceCopy`/`proxyCopy`/`percentCopy`/`notMeasuredCopy` and every
  row's `analysis.text`, all server-authored and already passed through the backend's `assertClean()` banned-
  phrase check), `ReferenceGauge`'s colour-neutral behavior, `TierChip`, the "not measured" presentation, and
  every existing accessibility label are all **unchanged verbatim**. §9 restyles the screen's chrome (header,
  background, branding, row interaction, a PDF export action) — CLAUDE.md rule 1 / `docs/claims-and-scope.md`
  still rule out anything that grades a value or implies a score, and nothing in §9 does that. The skeleton
  overlay from §3/§4.5 stays capture-screen-only; it never appears once a measurement exists.
- The ML/measurement pipeline, `services/ml-service`, `packages/schemas`, ADR-018's scope decision
  (MediaPipe 2D, single camera, server-side). No AR framework, no PoseNet, no 3D pipeline, no new measurement
  source. The on-device `VisionPoseDetector` this overlay reads from is already guidance-only and already
  never uploaded or shown as a number (`VisionPoseDetector.swift`'s own doc comment) — extending its joint set
  from 11 to 13 for a nicer-looking overlay does not change that invariant.
- `docs/HANDOFF.md` §5's standing decisions (AR removed, Vision on-device is guidance-only) are unaffected —
  this stays pure SwiftUI/Vision, no ARKit.

## 3. Decisions (from the brainstorm)

| Topic | Decision |
|---|---|
| Visual direction | "Neon Clinical": dark aubergine base (`#0e0a16` → `#2a1744` radial), glowing violet (`#b98cff`) accent, keeps the existing brand purple family rather than introducing an unrelated palette. |
| Typography (shell only) | Bold rounded sans (`SF Pro Rounded`, heavy weight) for headings on shell screens. The report screen's serif/mono pairing is untouched. |
| Splash | Plays once per app launch (not every screen transition): glowing mark pulses, an expanding ring animates outward, ~1.1–1.3s, then cross-fades to the mode chooser. |
| Mode chooser | Full-bleed, **vertically swipeable** (up/down) between two half-screen-styled panels — not the old stacked card list. Dot page indicator on the right edge; subtle up/down arrow affordance; each panel has a drifting dot-grid texture and a soft floating glow orb for depth, plus a custom line-icon (not emoji). |
| Capture skeleton overlay | A smooth, curved (not blocky) neon skeleton drawn over the live camera feed during a hold, with **13 joints**: head, L/R shoulder, L/R elbow, L/R wrist, L/R hip, pelvis-center, L/R knee, L/R ankle. A light pulse travels along each bone; joints softly pulse in size/opacity. Purely decorative — see §2. |

## 4. Components

### 4.1 `Sources/DesignSystem/NeonTheme.swift` (new)

A second token set alongside `Theme`, used only by the three shell screens:

```swift
enum NeonTheme {
    static let bgDeep = Color(hex: 0x0e0a16)
    static let bgGlow = Color(hex: 0x2a1744)
    static let violet = Color(hex: 0xb98cff)
    static let violetDim = Color(hex: 0x6e3fc9)
    static let mint = Color(hex: 0x39ffc4)   // skeleton's second gradient stop / HUD accent
    static let textPrimary = Color(hex: 0xefeaf6)
    static let textDim = Color(hex: 0x9d93ae)
}
enum NeonTypo {
    static let hero = Font.system(.largeTitle, design: .rounded).weight(.heavy)
    static let heading = Font.system(.title2, design: .rounded).weight(.bold)
}
```

`Theme`/`Typo` (the report-screen tokens) are untouched; nothing under `Sources/Report/` imports `NeonTheme`.

### 4.2 `Sources/App/SplashView.swift` (new)

- A `View` with the pulsing glow mark + expanding `Circle().stroke(...)` ring (both driven by
  `.animation(.easeInOut(duration: 1.1).repeatForever(...), value:)` gated by a single pass, not looping —
  see §6 for the reduce-motion fallback), the wordmark in `NeonTypo.hero`, and a one-line subtitle.
- Shown by `RootView` for a fixed ~1.2s before the existing mode-chooser/consent flow mounts, gated on a
  simple `@State` timer — not a loading gate (it does not wait on any network call; `BatteryClient().fetch()`
  still runs where it already does, after the splash has handed off).
- Shown once per **app launch** (process lifetime), not once per session: a `@State` flag owned by
  `BeAIveApp`/`RootView`, reset only when the process restarts. No persistence needed.

### 4.3 `Sources/Session/ModeChooserView.swift` (rework)

- Replace the `ScrollView` of stacked cards with a `TabView(selection:)` using `.tabViewStyle(.page(indexDisplayMode: .never))`
  rotated for vertical paging (SwiftUI's page style is horizontal by default; achieved with a `.rotationEffect(.degrees(90))`
  on the `TabView` and a counter-rotation on each page's content — the standard SwiftUI technique for a vertical pager).
- Two full-bleed pages, each: a `NeonTheme.bgGlow` radial gradient, a drifting dot-grid (`Canvas` with a small
  repeating particle animation, or a tiled image — implementation's choice, cost should stay cheap since it's
  only on-screen for seconds), a floating blurred orb (`Circle().blur(30)` + up/down `.offset` animation), the
  custom SF Symbols-based line icon, title, and detail text pulled from the existing `SessionMode` enum
  (`mode.title`, `mode.detail` — unchanged).
- A custom dot-page indicator on the trailing edge (`VStack` of small capsules, active one taller/glowing),
  since `.indexDisplayMode: .never` hides the system one (the system horizontal dots don't fit a vertical
  layout).
- **Preserved, not dropped:** the `onChoose` callback and `onViewResults` button ("Your results") and the
  "Results are camera-based estimates that a clinician reviews." disclaimer — both still need a home. Placed
  as a persistent small footer bar below the swipeable pager (not inside either page), so they're reachable
  regardless of which mode is currently showing and the required disclaimer text is never only one swipe away
  from being missed.
- **Accessibility:** `TabView(.page)` already exposes paging to VoiceOver (swipe left/right — or in our
  rotated case, effectively up/down — advances the selection via the standard adjustable/page gesture), so no
  gesture-only trap is introduced. `onChoose` remains reachable via a normal tap/VoiceOver-activate on the
  visible page, exactly as today.

### 4.4 `Sources/Capture/VisionPoseDetector.swift` (extend)

Add four joints to `VisionJointMapping.visionNames` so the guidance pose carries elbows and wrists (Vision
already supports `.leftElbow`, `.rightElbow`, `.leftWrist`, `.rightWrist` — no new framework):

```swift
.leftElbow: .leftElbow, .rightElbow: .rightElbow,
.leftWrist: .leftWrist, .rightWrist: .rightWrist,
```

`BodyPose2D.Joint` (in `GuidanceEngine.swift`) gains four matching cases. This is additive only —
`GuidanceEngine`'s existing framing/stillness checks keep using the joints they already use; nothing about
guidance logic, quality gating, or the measurement pipeline changes. The resulting 13-joint set (head via
`nose`, 2 shoulders, 2 elbows, 2 wrists, 2 hips + 1 synthesized pelvis-center midpoint, 2 knees, 2 ankles) is
for the overlay only.

### 4.5 `Sources/Capture/SkeletonOverlayView.swift` (new)

- Takes a `BodyPose2D?` (from `BatteryRunner.pose`, already `@Published` and already plumbed to `BatteryView`)
  and the capture frame's size, and draws the skeleton with SwiftUI `Canvas`:
  - Bones as `Path` quadratic curves (not straight `Line`s) between joint pairs, stroked with a
    `LinearGradient` from `NeonTheme.mint` to `NeonTheme.violet`, `lineCap: .round`, plus a `.shadow`/blur
    pass for the glow (Canvas supports `context.addFilter(.blur(radius:))` or a drawn larger low-opacity
    duplicate stroke beneath the sharp one — implementation's choice for perf).
  - Joints as small circles, gently pulsing (size/opacity) via a `TimelineView(.animation)` driving a shared
    phase, not a separate animation per joint (cheaper, stays in sync).
  - A faint traveling dash offset along each bone path for the "light flowing" effect from the mockup.
- When `pose` is `nil` or missing more than a few joints (person not in frame yet), the overlay simply doesn't
  draw those bones — it never guesses a joint's position. This mirrors the same "don't fabricate" discipline
  the rest of the codebase uses, even though this view only ever produces decoration, not a stored value.
- Inserted into `BatteryView.swift`'s existing `ZStack { if let recorder { CameraPreviewView(...) } }` block,
  directly above the preview and below `FramingBrackets()`, so framing brackets + skeleton + camera compose as
  they appear in the mockup.

## 5. What does NOT change

- No neon *skeleton* or splash-style pulsing ring ever appears on the report screen — §9's dark treatment is
  calmer and static/slow by design (see §9.4), distinct from the capture screen's energy.
- The ML pipeline, `MetricResult`, `assessment-report` schema, `measurementMethod`/provenance work from this
  session, the Study A agreement harness — nothing here touches any of that. The report screen renders
  whatever `AssessmentReport` the backend already sends; §9 changes no decoding, no model type beyond adding
  a view-only "row expanded" UI state.
- `services/backend-api`, `apps/clinician-web` — clinician dashboard keeps its existing look; this spec is
  iOS-only. (If the owner wants the same energy on the web dashboard later, that's a separate brainstorm — web
  and iOS target different audiences: clinicians reviewing data vs. a patient reading their own report.)
- Camera permission flow, consent flow, symptom-stop button, Keychain/token handling — all unrelated to this
  visual layer and untouched.
- A thermal-asymmetry section, "Excellent"/"Textbook perfect"-style grading wording, and colour-coded
  good/bad values were all shown as reference screenshots from a different app and explicitly **rejected** —
  see §9.1. This product has no thermal/IR sensor (confirmed earlier in the project) and would be fabricating
  a measurement by showing one; the grading wording is exactly what `docs/claims-and-scope.md` bans.

## 6. Animation & accessibility notes

- Every repeating animation (splash pulse/ring, orb float, bone light-flow, joint pulse) must check
  `UIAccessibility.isReduceMotionEnabled` (SwiftUI: `@Environment(\.accessibilityReduceMotion)`) and fall back
  to a static/non-animated presentation — pulsing glow becomes a fixed glow, the traveling dash becomes a
  steady stroke, the splash ring simply doesn't expand (mark still shows, just static). This is a hard
  requirement, not a nice-to-have, consistent with the rest of the app's accessibility posture.
- None of the new animations block input or gate navigation beyond the fixed ~1.2s splash timer.

## 7. Testing

- SwiftUI preview coverage via the existing `-designPreview` debug-launch pattern
  (`Sources/App/BeAIveApp.swift`): add `splash`, `mode-chooser` cases alongside the existing
  `report|capture|reps|setup|patients|results` ones, so each can be eyeballed on-device without running a
  full session.
- `VisionJointMapping`/`BodyPose2D.Joint` additions get unit tests mirroring the existing coverage in
  whatever test file already covers `VisionPoseDetector`/`GuidanceEngine` (confirm the 4 new joints map
  correctly and that `GuidanceEngine`'s existing behavior is unchanged — the new joints must be inert there).
- `SkeletonOverlayView` gets a few snapshot-free structural tests (it draws nothing when `pose` is `nil`, it
  draws only the bones whose both endpoint joints are present) rather than pixel tests, matching this
  project's existing preference for behavior-level tests over UI snapshot tests.
- Full iOS suite (`xcodebuild ... test`) must stay green; this redesign is additive to three files plus two
  new files, so the existing 98 (+ whatever M1 added) should be unaffected aside from the new cases above.
- Build + install to the connected device (`xcodebuild ... build`, `xcrun devicectl device install app`,
  `xcrun devicectl device process launch`) to confirm the real animation feel, exactly as done earlier this
  session — glow/blur performance on a 2018 iPhone XR is worth checking specifically since it's the oldest
  device in reach.

## 9. Report screen — branded dark chrome, interactive rows, PDF export

Added after reviewing the existing code: `Sources/Report/AssessmentReportView.swift` already renders each
battery section as a dark "readout" panel (`Theme.readout`/`readoutRaised`), and `Sources/Report/ReferenceGauge.swift`
already draws a colour-neutral estimate-vs-reference bar with a reveal animation that respects Reduce Motion —
i.e. the "interactive position bar" from the brainstorm mockup **already exists** and needs no reinvention.
What's actually missing against the mockups: the screen's outer background/header is still light paper with no
brand mark, rows aren't individually collapsible, and there's no export action. This section is additive to
the existing view, not a rewrite.

### 9.1 What was rejected from the reference screenshots

The owner shared three screenshots from a different app as inspiration. Two things from them are **not**
going into this product and must not reappear in a later iteration without this being revisited explicitly:

- A "Thermal Asymmetry" section (Trapezius ΔT, Lumbar ΔT) — this app has no thermal/IR sensor; showing one
  would be fabricating a measurement (CLAUDE.md rule 3).
- Wording like "Excellent", "Textbook perfect", "mathematically perfect neutral posture", "Typical for
  screen-heavy workflows", "Worth monitoring if paired with unilateral back stiffness" — grading, causal and
  prognosis language `docs/claims-and-scope.md` bans. The real report builder's `assertClean()`
  (`services/backend-api/src/reports/report-builder.ts`) already refuses to build a report containing banned
  wording, so this was never reachable through the real pipeline regardless.

What *is* adopted from the reference: the clean 4-column conceptual layout (metric / your value / reference /
analysis — already how `ReadoutRow` is organized today, just restyled) and the idea of a stronger, more
confident visual presentation.

### 9.2 Visual changes

| Element | Today | New |
|---|---|---|
| Outer background | `paperBackground()` (light ivory) | Dark, matching `NeonTheme.bgDeep`/`bgGlow` family — but **no pulsing/glow animation**, a static radial gradient only (see §9.4). |
| Header | `Eyebrow` + plain `Text` title, no logo | Adds `BrandHeader()` (already exists, used elsewhere, just not here) above the title, in its dark-background variant. |
| Section readout panels | Already dark (`Theme.readout`) | Unchanged — they already read correctly against a dark outer background; today they sit awkwardly on light paper. |
| `ReferenceGauge` | Already colour-neutral bar + marker + reveal animation | **Unchanged.** This is the "position bar" from the mockup. |
| Row interaction | Analysis text always visible | Each `ReadoutRow` becomes tappable: collapsed by default shows metric/value/reference/position only; expanding reveals the analysis sentence and the `ReferenceGauge` detail, with a `.animation(reduceMotion ? nil : .easeInOut(duration: 0.2))` height transition. A chevron indicates state, mirroring the mockup. |
| Export | None | A toolbar/footer "Share as PDF" action (§9.3). |

`TierChip`, the "not measured" card, `notMeasurableList`, `footnote`, and every copy string are unchanged.

### 9.3 PDF export (pulls forward a slice of M5)

`docs/HANDOFF.md` §5 lists "PDF export is planned for M5 and is not built yet" as a standing decision — this
adds a minimal version now, scoped to *exporting the screen the patient is already looking at*, not a
separate print-layout engine:

- A `ShareLink` (iOS 16+, already the project's deployment target) wrapping a `Transferable` that renders
  `AssessmentReportView`'s content to a single tall PDF page via `UIGraphicsPDFRenderer` driving a
  `UIHostingController`'s layer (`view.layer.render(in: context.cgContext)`), sized to the view's measured
  content height (not the screen height) so nothing is cropped.
- The rendered PDF uses the *current* on-screen state (no separate "print theme") — if all rows are
  collapsed, the PDF is compact; if a patient wants the full detail in the PDF, they expand the rows first.
  This keeps the exporter dead simple (one render path, not two) and is explicitly good-enough-for-v1; a
  "always expand everything in the PDF" toggle is a reasonable follow-up if it turns out to matter in practice.
- No server involvement — this is a client-side render of data the phone already fetched and already
  displays. No new backend route, no new schema.

### 9.4 Animation — report screen is deliberately calmer than the shell

Unlike the splash/chooser/capture screens (§3's "Neon Clinical" energy — pulsing marks, drifting orbs,
traveling light), the report screen's background gradient is **static**: no pulse, no drift. The only
animations here are the existing `ReferenceGauge` reveal-on-appear and the new row-expand/collapse transition,
both already short, purposeful, and Reduce-Motion-aware. This is a deliberate choice, not an oversight: a
report a patient and clinician both rely on should feel steady, not like the capture screen's "exciting"
energy — the dark/branded treatment is about confidence and polish, not spectacle.

### 9.5 Testing

- Existing `AssessmentReportView`/`ReferenceGauge`/report-related snapshot or behavior tests (wherever they
  live in the iOS test target) must stay green — no copy string, no gauge math, no tier/position logic
  changes.
- New: a test that a collapsed row hides the analysis text and an expanded row shows it (state-level, not
  pixel-level, matching this project's existing test style).
- New: a test that the PDF `Transferable` produces non-empty PDF data for the `.sample` report fixture
  (content-presence check, not a rendered-pixel comparison — brittle pixel tests for PDF output aren't worth
  it here).
- Add a `-designPreview report-dark` (or similar) case so the restyled screen can be eyeballed without a full
  session, alongside the existing `report`/`report-movement` cases.

## 10. Order of work

1. `NeonTheme.swift` (pure tokens, no behavior).
2. `SplashView.swift` + wire into `RootView`/`BeAIveApp`.
3. `VisionPoseDetector.swift` + `BodyPose2D.Joint` four-joint extension, test-first.
4. `SkeletonOverlayView.swift`, test-first for the "draws nothing without a pose" / "only draws complete
   bones" behavior, then wire into `BatteryView.swift`.
5. `ModeChooserView.swift` rework (the biggest single change — touches the vertical-pager technique, the
   footer bar, and the dot indicator).
6. Add the two new `-designPreview` cases.
7. §9: restyle `AssessmentReportView`'s background/header, add row expand/collapse, add the PDF `ShareLink`,
   test-first for the new row-state and PDF-data-presence behavior.
8. Add the `report-dark` `-designPreview` case.
9. Build to the connected device; iterate on glow/blur performance if needed.
10. Full `xcodebuild ... test` run before calling it done.
