# iOS "neon shell" redesign — design

Status: approved (brainstormed interactively with visual-companion mockups) · 2026-10-23

## 1. Goal

The owner's reaction to the current "clinical instrument on paper" look (`Sources/DesignSystem/Theme.swift`)
on a real device was that it feels flat and unexciting. This spec adds an energetic, animated, "neon" visual
layer to the **app shell** — splash, mode chooser, and the live capture screen — while leaving the report
screens exactly as they are.

## 2. Scope

**In scope** (new `Sources/DesignSystem/NeonTheme.swift` + three screens):
- A new animated splash screen, shown once per app launch.
- The mode chooser (`Sources/Session/ModeChooserView.swift`), rebuilt as a vertically swipeable, full-bleed
  two-panel view (Clinic / Patient).
- The live capture screen (`Sources/Session/BatteryView.swift` → `GuidedCaptureView`'s `stage` slot), which
  gains an animated 13-joint neon skeleton overlay traced over the camera preview during a hold.

**Explicitly out of scope** — these do not change:
- `Sources/Report/*` (the patient-facing report view) and anything under `apps/clinician-web/src/report/` —
  CLAUDE.md rule 1 / `docs/claims-and-scope.md` require these stay neutral, never gamified, never implying a
  graded score. The skeleton overlay is decoration for the *capture* screen only; it never appears once a
  measurement exists.
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

- `AssessmentReportView` and all of `Sources/Report/` — no neon theme, no skeleton, no splash.
- The ML pipeline, `MetricResult`, `assessment-report` schema, `measurementMethod`/provenance work from this
  session, the Study A agreement harness — nothing here touches any of that.
- `services/backend-api`, `apps/clinician-web` — clinician dashboard keeps its existing look; this spec is
  iOS-shell-only. (If the owner wants the same energy on the web dashboard later, that's a separate
  brainstorm — web and iOS target different audiences: clinicians reviewing data vs. a patient starting a
  session.)
- Camera permission flow, consent flow, symptom-stop button, Keychain/token handling — all unrelated to this
  visual layer and untouched.

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

## 8. Order of work

1. `NeonTheme.swift` (pure tokens, no behavior).
2. `SplashView.swift` + wire into `RootView`/`BeAIveApp`.
3. `VisionPoseDetector.swift` + `BodyPose2D.Joint` four-joint extension, test-first.
4. `SkeletonOverlayView.swift`, test-first for the "draws nothing without a pose" / "only draws complete
   bones" behavior, then wire into `BatteryView.swift`.
5. `ModeChooserView.swift` rework (the biggest single change — touches the vertical-pager technique, the
   footer bar, and the dot indicator).
6. Add the two new `-designPreview` cases.
7. Build to the connected device; iterate on glow/blur performance if needed.
8. Full `xcodebuild ... test` run before calling it done.
