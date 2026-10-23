# Neon Shell Redesign, Part 1 (Splash / Mode Chooser / Capture Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the "Neon Clinical" shell from `docs/superpowers/specs/2026-10-23-neon-shell-redesign-design.md`
§1–8: a new splash screen, a vertically-swipeable full-bleed mode chooser, and a restyled 13-joint neon
skeleton overlay on the live capture screen. (§9, the report-screen redesign, is a separate plan.)

**Architecture:** Pure-SwiftUI, no new frameworks. A new `NeonTheme`/`NeonTypo` token set lives alongside the
existing `Theme`/`Typo` and is used only by these three screens. The capture skeleton is a restyle + small
extension of the `SkeletonOverlay` view that already exists and is already wired into the live camera preview
— not a new file. The on-device Vision pose detector gains four more joints (elbows, wrists) it doesn't have
today, purely for this overlay; nothing about guidance logic or the measurement pipeline changes.

**Tech Stack:** Swift / SwiftUI (iOS 16 deployment target), XCTest, `xcodegen`, `xcodebuild`.

---

## File structure

**Create:**
- `apps/ios-client/Sources/DesignSystem/NeonTheme.swift` — dark/violet/mint color + rounded-font tokens.
- `apps/ios-client/Sources/App/SplashView.swift` — the one-time launch screen.
- `apps/ios-client/Tests/SkeletonOverlayTests.swift` — tests for the overlay's new pure functions.

**Modify:**
- `apps/ios-client/Sources/Assessment/GuidanceEngine.swift` — `BodyPose2D.Joint` gains 4 cases.
- `apps/ios-client/Sources/Capture/VisionPoseDetector.swift` — `VisionJointMapping.visionNames` gains the 4
  matching Vision joint names.
- `apps/ios-client/Sources/Overlay/SkeletonOverlay.swift` — restyled: curved gradient-glow bones, pulsing
  joints, extracted pure `visibleBoneJoints`/`visibleJoints` functions, 13 drawn joints (ears stay available
  for guidance but are no longer drawn).
- `apps/ios-client/Sources/Session/ModeChooserView.swift` — rebuilt as a vertical full-bleed pager.
- `apps/ios-client/Sources/App/RootView.swift` — gains an initial `.splash` step.
- `apps/ios-client/Sources/App/BeAIveApp.swift` — two new `-designPreview` cases (`splash`, `mode-chooser`).
- `apps/ios-client/Tests/VisionJointMappingTests.swift` — one new test for the 4-joint extension.

No other files change. No schema, backend, or ml-service changes — this plan is iOS-shell-only.

---

### Task 1: `NeonTheme.swift` — pure tokens

**Files:**
- Create: `apps/ios-client/Sources/DesignSystem/NeonTheme.swift`

This is pure constant data (colors, fonts) with no logic to unit test — consistent with `Theme.swift`, which
also has no test file. One step: write it, build, commit.

- [ ] **Step 1: Write the file**

```swift
import SwiftUI

/// "Neon Clinical" tokens for the app shell only - splash, mode chooser, and
/// the live capture screen's skeleton overlay
/// (docs/superpowers/specs/2026-10-23-neon-shell-redesign-design.md §3-4).
/// Dark aubergine base, glowing violet accent (same brand-purple family as
/// Theme.brand), mint as the skeleton's second gradient stop. The report
/// screens under Sources/Report/ do not import this - they keep Theme/Typo
/// unchanged (see the spec's §2 scope).
enum NeonTheme {
    static let bgDeep = Color(hex: 0x0e0a16)
    static let bgGlow = Color(hex: 0x2a1744)
    static let violet = Color(hex: 0xb98cff)
    static let violetDim = Color(hex: 0x6e3fc9)
    static let mint = Color(hex: 0x39ffc4)
    static let textPrimary = Color(hex: 0xefeaf6)
    static let textDim = Color(hex: 0x9d93ae)
}

/// Bold rounded sans for shell headings - distinct from Typo's serif/mono
/// pairing used by the report screen.
enum NeonTypo {
    static let hero = Font.system(.largeTitle, design: .rounded).weight(.heavy)
    static let heading = Font.system(.title2, design: .rounded).weight(.bold)
    static let body = Font.system(.body, design: .rounded)
    static let caption = Font.system(.caption, design: .rounded).weight(.semibold)
}
```

`Color(hex:)` is already defined as an extension in `Sources/DesignSystem/Theme.swift` and is visible to this
file (same module), so no import beyond `SwiftUI` is needed.

- [ ] **Step 2: Build to confirm it compiles**

```bash
cd apps/ios-client && xcodegen generate && xcodebuild -project PosturePulse.xcodeproj -scheme PosturePulse -destination 'id=55079423-C12B-40F0-979D-A182A2BD94E6' build
```
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Commit**

```bash
git add apps/ios-client/Sources/DesignSystem/NeonTheme.swift
git commit -m "ios: add NeonTheme/NeonTypo tokens for the shell redesign"
```

---

### Task 2: Extend `BodyPose2D.Joint` with elbows and wrists

**Files:**
- Modify: `apps/ios-client/Sources/Assessment/GuidanceEngine.swift:9-11`
- Modify: `apps/ios-client/Sources/Capture/VisionPoseDetector.swift` (the `visionNames` dictionary)
- Modify: `apps/ios-client/Tests/VisionJointMappingTests.swift`

The existing test `testEveryGuidanceJointHasAVisionName` in `VisionJointMappingTests.swift` already asserts
`Set(VisionJointMapping.visionNames.keys) == Set(BodyPose2D.Joint.allCases)` — it will fail the moment the
`Joint` enum gains cases without `visionNames` gaining matching entries, and vice versa. Use that as the
TDD forcing function, plus one new explicit test naming the four new joints.

- [ ] **Step 1: Write the failing test**

Add to `apps/ios-client/Tests/VisionJointMappingTests.swift` (inside the existing `VisionJointMappingTests`
class, after `testEveryGuidanceJointHasAVisionName`):

```swift
    func testElbowAndWristJointsAreMappedForTheSkeletonOverlay() {
        let expected: Set<BodyPose2D.Joint> = [.leftElbow, .rightElbow, .leftWrist, .rightWrist]
        XCTAssertTrue(expected.isSubset(of: Set(VisionJointMapping.visionNames.keys)))
        XCTAssertTrue(expected.isSubset(of: Set(BodyPose2D.Joint.allCases)))
    }
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/ios-client && xcodegen generate && xcodebuild -project PosturePulse.xcodeproj -scheme PosturePulse -destination 'id=55079423-C12B-40F0-979D-A182A2BD94E6' -only-testing:PosturePulseTests/VisionJointMappingTests test
```
Expected: **compile failure** — `.leftElbow` etc. don't exist on `BodyPose2D.Joint` yet. A compile error here
is the expected "red" state for this kind of change in a strongly-typed language.

- [ ] **Step 3: Add the four joints to `BodyPose2D.Joint`**

In `apps/ios-client/Sources/Assessment/GuidanceEngine.swift`, change:

```swift
    enum Joint: CaseIterable {
        case nose, leftEar, rightEar, leftShoulder, rightShoulder, leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle
    }
```

to:

```swift
    enum Joint: CaseIterable {
        case nose, leftEar, rightEar, leftShoulder, rightShoulder, leftElbow, rightElbow, leftWrist, rightWrist,
             leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle
    }
```

- [ ] **Step 4: Add the four joints to `VisionJointMapping.visionNames`**

In `apps/ios-client/Sources/Capture/VisionPoseDetector.swift`, change:

```swift
    static let visionNames: [BodyPose2D.Joint: VNHumanBodyPoseObservation.JointName] = [
        .nose: .nose,
        .leftEar: .leftEar,
        .rightEar: .rightEar,
        .leftShoulder: .leftShoulder,
        .rightShoulder: .rightShoulder,
        .leftHip: .leftHip,
        .rightHip: .rightHip,
        .leftKnee: .leftKnee,
        .rightKnee: .rightKnee,
        .leftAnkle: .leftAnkle,
        .rightAnkle: .rightAnkle,
    ]
```

to:

```swift
    static let visionNames: [BodyPose2D.Joint: VNHumanBodyPoseObservation.JointName] = [
        .nose: .nose,
        .leftEar: .leftEar,
        .rightEar: .rightEar,
        .leftShoulder: .leftShoulder,
        .rightShoulder: .rightShoulder,
        .leftElbow: .leftElbow,
        .rightElbow: .rightElbow,
        .leftWrist: .leftWrist,
        .rightWrist: .rightWrist,
        .leftHip: .leftHip,
        .rightHip: .rightHip,
        .leftKnee: .leftKnee,
        .rightKnee: .rightKnee,
        .leftAnkle: .leftAnkle,
        .rightAnkle: .rightAnkle,
    ]
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd apps/ios-client && xcodegen generate && xcodebuild -project PosturePulse.xcodeproj -scheme PosturePulse -destination 'id=55079423-C12B-40F0-979D-A182A2BD94E6' -only-testing:PosturePulseTests/VisionJointMappingTests test
```
Expected: `** TEST SUCCEEDED **`, both `testEveryGuidanceJointHasAVisionName` and
`testElbowAndWristJointsAreMappedForTheSkeletonOverlay` pass.

- [ ] **Step 6: Run the full guidance-related suite to confirm nothing else broke**

```bash
cd apps/ios-client && xcodebuild -project PosturePulse.xcodeproj -scheme PosturePulse -destination 'id=55079423-C12B-40F0-979D-A182A2BD94E6' -only-testing:PosturePulseTests/GuidanceEngineTests test
```
Expected: `** TEST SUCCEEDED **` — `GuidanceEngineTests`'s existing pose fixtures don't reference the new
joints, so adding cases to an already-`CaseIterable` enum doesn't change any existing dictionary literal's
meaning.

- [ ] **Step 7: Commit**

```bash
git add apps/ios-client/Sources/Assessment/GuidanceEngine.swift apps/ios-client/Sources/Capture/VisionPoseDetector.swift apps/ios-client/Tests/VisionJointMappingTests.swift
git commit -m "ios: add elbow/wrist joints to on-device guidance pose"
```

---

### Task 3: Restyle `SkeletonOverlay` — curved neon bones, pulsing joints, 13 drawn joints

**Files:**
- Modify: `apps/ios-client/Sources/Overlay/SkeletonOverlay.swift`
- Create: `apps/ios-client/Tests/SkeletonOverlayTests.swift`

The overlay's actual drawing is SwiftUI `Canvas` code inside a `View.body` and isn't unit-testable directly.
This task first extracts the "which bones/joints are visible" decision into pure static functions (testable),
then restyles the drawing itself (verified by build + on-device check, matching this project's existing
testing style of behavior-level tests over UI snapshot tests).

- [ ] **Step 1: Write the failing tests for the pure functions**

Create `apps/ios-client/Tests/SkeletonOverlayTests.swift`:

```swift
import XCTest
@testable import PostureAnalysisClient

final class SkeletonOverlayTests: XCTestCase {
    private typealias J = BodyPose2D.Joint

    func testNoPoseDrawsNoBonesOrJoints() {
        XCTAssertTrue(SkeletonOverlay.visibleBoneJoints(for: nil).isEmpty)
        XCTAssertTrue(SkeletonOverlay.visibleJoints(for: nil).isEmpty)
    }

    func testOnlyBonesWithBothConfidentEndpointsAreDrawn() {
        let pose = BodyPose2D(joints: [
            .leftShoulder: .init(x: 0.4, y: 0.3, confidence: 0.9),
            .rightShoulder: .init(x: 0.6, y: 0.3, confidence: 0.9),
            .leftElbow: .init(x: 0.3, y: 0.5, confidence: 0.1), // below the 0.3 threshold
        ])
        let bones = SkeletonOverlay.visibleBoneJoints(for: pose)
        XCTAssertTrue(bones.contains { $0 == (J.leftShoulder, J.rightShoulder) })
        XCTAssertFalse(bones.contains { $0.0 == J.leftShoulder && $0.1 == J.leftElbow })
    }

    func testOnlyConfidentJointsAreDrawnAndEarsAreNeverDrawn() {
        let pose = BodyPose2D(joints: [
            .nose: .init(x: 0.5, y: 0.1, confidence: 0.9),
            .leftEar: .init(x: 0.52, y: 0.09, confidence: 0.9),
            .rightShoulder: .init(x: 0.46, y: 0.2, confidence: 0.1), // below threshold
        ])
        let drawn = SkeletonOverlay.visibleJoints(for: pose)
        XCTAssertTrue(drawn.contains(.nose))
        XCTAssertFalse(drawn.contains(.leftEar), "ears are tracked for guidance but never drawn by this overlay")
        XCTAssertFalse(drawn.contains(.rightShoulder), "below the confidence threshold")
    }

    func testDrawnJointsAreExactlyTheThirteenNamedInTheSpec() {
        let expected: Set<J> = [
            .nose, .leftShoulder, .rightShoulder, .leftElbow, .rightElbow, .leftWrist, .rightWrist,
            .leftHip, .rightHip, .leftKnee, .rightKnee, .leftAnkle, .rightAnkle,
        ]
        XCTAssertEqual(Set(SkeletonOverlay.drawnJoints), expected)
        XCTAssertEqual(SkeletonOverlay.drawnJoints.count, 13)
    }

    func testCurvedBoneStartsAndEndsAtTheGivenPoints() {
        let path = SkeletonOverlay.curvedBone(from: CGPoint(x: 0, y: 0), to: CGPoint(x: 100, y: 0))
        XCTAssertFalse(path.isEmpty)
        XCTAssertEqual(path.currentPoint, CGPoint(x: 100, y: 0))
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/ios-client && xcodegen generate && xcodebuild -project PosturePulse.xcodeproj -scheme PosturePulse -destination 'id=55079423-C12B-40F0-979D-A182A2BD94E6' -only-testing:PosturePulseTests/SkeletonOverlayTests test
```
Expected: **compile failure** — `visibleBoneJoints`, `visibleJoints`, `drawnJoints`, and `curvedBone` don't
exist yet on `SkeletonOverlay`.

- [ ] **Step 3: Replace `SkeletonOverlay.swift` with the restyled version**

Replace the full contents of `apps/ios-client/Sources/Overlay/SkeletonOverlay.swift`:

```swift
import SwiftUI

/// Draws the on-device guidance pose as an animated neon skeleton over the
/// letterboxed camera preview, so the person can see they are framed. Purely
/// decorative (docs/superpowers/specs/2026-10-23-neon-shell-redesign-design.md
/// §4.5) - no angles, no numbers, no colours that suggest good or bad. When a
/// joint isn't confidently detected, the bones touching it simply aren't
/// drawn - never guessed.
struct SkeletonOverlay: View {
    let pose: BodyPose2D?
    /// Oriented camera frame size, to place the letterboxed image.
    let imageSize: CGSize

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Every bone this overlay can draw. A bone is only drawn when both its
    /// joints are present with at least `minConfidence` (see `visibleBoneJoints`).
    static let bones: [(BodyPose2D.Joint, BodyPose2D.Joint)] = [
        (.nose, .leftShoulder), (.nose, .rightShoulder),
        (.leftShoulder, .rightShoulder),
        (.leftShoulder, .leftElbow), (.leftElbow, .leftWrist),
        (.rightShoulder, .rightElbow), (.rightElbow, .rightWrist),
        (.leftShoulder, .leftHip), (.rightShoulder, .rightHip),
        (.leftHip, .rightHip),
        (.leftHip, .leftKnee), (.leftKnee, .leftAnkle),
        (.rightHip, .rightKnee), (.rightKnee, .rightAnkle),
    ]

    /// The 13 joints this overlay ever draws a dot for (head/nose, shoulders,
    /// elbows, wrists, hips, knees, ankles). A subset of BodyPose2D.Joint.allCases:
    /// the ears are still tracked for guidance (GuidanceEngine's near-side
    /// detection) but are never drawn by this overlay.
    static let drawnJoints: [BodyPose2D.Joint] = [
        .nose, .leftShoulder, .rightShoulder, .leftElbow, .rightElbow, .leftWrist, .rightWrist,
        .leftHip, .rightHip, .leftKnee, .rightKnee, .leftAnkle, .rightAnkle,
    ]

    private static let minConfidence = 0.3

    /// Pure: which bones have both endpoints confidently detected. No pose ->
    /// no bones. A bone with one missing or low-confidence joint is left out,
    /// never drawn from a guessed position.
    static func visibleBoneJoints(for pose: BodyPose2D?, minConfidence: Double = SkeletonOverlay.minConfidence) -> [(BodyPose2D.Joint, BodyPose2D.Joint)] {
        guard let pose else { return [] }
        return bones.filter { a, b in
            (pose.joints[a]?.confidence ?? 0) >= minConfidence && (pose.joints[b]?.confidence ?? 0) >= minConfidence
        }
    }

    /// Pure: which of the 13 drawn joints are confidently detected.
    static func visibleJoints(for pose: BodyPose2D?, minConfidence: Double = SkeletonOverlay.minConfidence) -> [BodyPose2D.Joint] {
        guard let pose else { return [] }
        return drawnJoints.filter { (pose.joints[$0]?.confidence ?? 0) >= minConfidence }
    }

    /// A gentle quadratic curve between two points, bulging perpendicular to
    /// the segment - smoother than a straight line, matching the brainstormed
    /// mockup (docs/superpowers/specs/2026-10-23-neon-shell-redesign-design.md §4.5).
    static func curvedBone(from a: CGPoint, to b: CGPoint) -> Path {
        let mid = CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
        let dx = b.x - a.x, dy = b.y - a.y
        let length = max(hypot(dx, dy), 1)
        let px = -dy / length, py = dx / length // perpendicular unit vector
        let bulge = length * 0.12
        let control = CGPoint(x: mid.x + px * bulge, y: mid.y + py * bulge)
        var path = Path()
        path.move(to: a)
        path.addQuadCurve(to: b, control: control)
        return path
    }

    var body: some View {
        GeometryReader { geo in
            let rect = Self.fittedRect(image: imageSize, in: geo.size)
            TimelineView(.animation(paused: reduceMotion)) { timeline in
                Canvas { context, _ in
                    guard let pose else { return }
                    func point(_ joint: BodyPose2D.Joint) -> CGPoint? {
                        guard let p = pose.joints[joint], p.confidence >= Self.minConfidence else { return nil }
                        return CGPoint(x: rect.minX + p.x * rect.width, y: rect.minY + p.y * rect.height)
                    }
                    let phase = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.6) / 1.6

                    for (a, b) in Self.visibleBoneJoints(for: pose) {
                        guard let pa = point(a), let pb = point(b) else { continue }
                        let path = Self.curvedBone(from: pa, to: pb)
                        let gradient = GraphicsContext.Shading.linearGradient(
                            Gradient(colors: [NeonTheme.mint, NeonTheme.violet]),
                            startPoint: pa, endPoint: pb
                        )
                        // Glow: a wider, dimmer duplicate stroke beneath the sharp one -
                        // no GraphicsContext blur filter, so this stays iOS-16-safe.
                        context.stroke(path, with: .color(NeonTheme.violet.opacity(0.35)), style: StrokeStyle(lineWidth: 9, lineCap: .round))
                        context.stroke(
                            path, with: gradient,
                            style: StrokeStyle(
                                lineWidth: 3, lineCap: .round,
                                dash: reduceMotion ? [] : [6, 10],
                                dashPhase: reduceMotion ? 0 : -phase * 16
                            )
                        )
                    }

                    for joint in Self.visibleJoints(for: pose) {
                        guard let p = point(joint) else { continue }
                        let pulse = reduceMotion ? 1.0 : 1.0 + 0.25 * sin(phase * 2 * .pi)
                        let radius = 4.5 * pulse
                        context.fill(
                            Path(ellipseIn: CGRect(x: p.x - radius - 3, y: p.y - radius - 3, width: (radius + 3) * 2, height: (radius + 3) * 2)),
                            with: .color(NeonTheme.violet.opacity(0.3))
                        )
                        context.fill(Path(ellipseIn: CGRect(x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2)), with: .color(.white))
                    }
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static func fittedRect(image: CGSize, in container: CGSize) -> CGRect {
        guard image.width > 0, image.height > 0, container.width > 0, container.height > 0 else { return .zero }
        let scale = min(container.width / image.width, container.height / image.height)
        let size = CGSize(width: image.width * scale, height: image.height * scale)
        return CGRect(x: (container.width - size.width) / 2, y: (container.height - size.height) / 2, width: size.width, height: size.height)
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/ios-client && xcodegen generate && xcodebuild -project PosturePulse.xcodeproj -scheme PosturePulse -destination 'id=55079423-C12B-40F0-979D-A182A2BD94E6' -only-testing:PosturePulseTests/SkeletonOverlayTests test
```
Expected: `** TEST SUCCEEDED **`, all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/ios-client/Sources/Overlay/SkeletonOverlay.swift apps/ios-client/Tests/SkeletonOverlayTests.swift
git commit -m "ios: restyle the capture skeleton overlay - neon gradient, glow, pulse, 13 joints"
```

---

### Task 4: `SplashView.swift` and wiring into `RootView`

**Files:**
- Create: `apps/ios-client/Sources/App/SplashView.swift`
- Modify: `apps/ios-client/Sources/App/RootView.swift`

No unit test here — `SplashView` is pure presentation + a fixed-duration timer, and this project doesn't
unit-test SwiftUI view bodies (confirmed: no test file exists for any other top-level screen view either).
Verified by build + the `-designPreview splash` case added in Task 6, then on-device.

- [ ] **Step 1: Write `SplashView.swift`**

```swift
import SwiftUI

/// Shown once per app launch, before the mode chooser - a fixed ~1.2s brand
/// moment, never a loading gate (nothing it shows depends on a network call;
/// RootView's battery fetch still runs where it already did, after this hands
/// off). docs/superpowers/specs/2026-10-23-neon-shell-redesign-design.md §4.2.
struct SplashView: View {
    let onFinished: () -> Void

    @State private var pulse = false
    @State private var visible = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            NeonTheme.bgDeep.ignoresSafeArea()
            RadialGradient(colors: [NeonTheme.bgGlow, NeonTheme.bgDeep], center: .center, startRadius: 0, endRadius: 280)
                .ignoresSafeArea()

            if !reduceMotion {
                Circle()
                    .strokeBorder(NeonTheme.violet.opacity(0.4), lineWidth: 1)
                    .frame(width: 150, height: 150)
                    .scaleEffect(pulse ? 1.6 : 0.6)
                    .opacity(pulse ? 0 : 0.9)
                    .animation(.easeOut(duration: 1.1).repeatForever(autoreverses: false), value: pulse)
            }

            VStack(spacing: 14) {
                Circle()
                    .fill(RadialGradient(colors: [NeonTheme.violet, NeonTheme.violetDim, .clear], center: .center, startRadius: 0, endRadius: 40))
                    .frame(width: 76, height: 76)
                    .shadow(color: NeonTheme.violet.opacity(0.55), radius: reduceMotion ? 10 : 20)
                    .scaleEffect(!reduceMotion && pulse ? 1.08 : 1)
                    .animation(reduceMotion ? nil : .easeInOut(duration: 1.1).repeatForever(autoreverses: true), value: pulse)

                Text("POSTUREPULSE")
                    .font(NeonTypo.heading)
                    .tracking(1)
                    .foregroundColor(NeonTheme.textPrimary)
                Text("Clinician-supervised assessment")
                    .font(NeonTypo.caption)
                    .foregroundColor(NeonTheme.textDim)
            }
        }
        .opacity(visible ? 1 : 0)
        .onAppear { pulse = true }
        .task {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { visible = false }
            try? await Task.sleep(nanoseconds: 200_000_000)
            onFinished()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("PosturePulse")
    }
}
```

(Total time on screen stays ~1.2s: a 1.0s hold, then a 0.2s fade-out before `onFinished` swaps `step` to
`.chooseMode` — this is what the spec's "then cross-fades to the mode chooser" means in practice, without
needing `RootView.Step` to become `Equatable` just to animate the switch itself.)

- [ ] **Step 2: Wire it into `RootView`**

In `apps/ios-client/Sources/App/RootView.swift`, change the `Step` enum (currently starting with
`case chooseMode`) to add `case splash` as the first case:

```swift
    private enum Step {
        case splash
        case chooseMode
        case clinicianSignIn
        case pickPatient
        case consent
        case preparing
        case setup(SessionCredentials, AssessmentBattery)
        case battery(SessionCredentials, AssessmentBattery)
        case done(SessionCredentials, completed: Bool)
        case results
    }
```

Change the initial state:

```swift
    @State private var step: Step = .splash
```

Add a `case .splash:` branch as the first case in `body`'s `switch step`:

```swift
        switch step {
        case .splash:
            SplashView(onFinished: { step = .chooseMode })
        case .chooseMode:
```

(leave every other case exactly as it is).

- [ ] **Step 3: Build to confirm it compiles**

```bash
cd apps/ios-client && xcodegen generate && xcodebuild -project PosturePulse.xcodeproj -scheme PosturePulse -destination 'id=55079423-C12B-40F0-979D-A182A2BD94E6' build
```
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Commit**

```bash
git add apps/ios-client/Sources/App/SplashView.swift apps/ios-client/Sources/App/RootView.swift
git commit -m "ios: add the neon splash screen, shown once per app launch"
```

---

### Task 5: Rebuild `ModeChooserView` as a vertical full-bleed pager

**Files:**
- Modify: `apps/ios-client/Sources/Session/ModeChooserView.swift`

No unit test — same reasoning as Task 4 (SwiftUI view body, no existing test convention for this). The
vertical-pager technique (rotate a horizontal `TabView(.page)` 90°, counter-rotate each page) is a well-known
SwiftUI recipe but genuinely needs on-device visual verification (Task 7) — if the swipe direction or page
sizing looks wrong once built, that's the moment to adjust the rotation/offset math below, not a sign the
plan is wrong to attempt it this way.

`onChoose` and `onViewResults` keep their exact existing signatures (`(SessionMode) -> Void` and
`(() -> Void)?`) so `RootView.swift`'s call site (`Sources/App/RootView.swift:44-58`) needs no change.

- [ ] **Step 1: Replace the full contents of `ModeChooserView.swift`**

```swift
import SwiftUI

/// First screen of every session: Clinic mode or Patient mode. A vertically
/// swipeable full-bleed pager
/// (docs/superpowers/specs/2026-10-23-neon-shell-redesign-design.md §4.3) -
/// swipe up/down between modes, tap the visible page to choose it.
struct ModeChooserView: View {
    let onChoose: (SessionMode) -> Void
    /// Set when this phone holds access to at least one assessment's results.
    var onViewResults: (() -> Void)?

    @State private var selection: SessionMode = .clinic

    var body: some View {
        VStack(spacing: 0) {
            pager
            footer
        }
        .background(NeonTheme.bgDeep.ignoresSafeArea())
    }

    private var pager: some View {
        GeometryReader { geo in
            ZStack {
                TabView(selection: $selection) {
                    ForEach(SessionMode.allCases) { mode in
                        ModePage(mode: mode, onChoose: { onChoose(mode) })
                            .frame(width: geo.size.height, height: geo.size.width)
                            .rotationEffect(.degrees(-90))
                            .tag(mode)
                    }
                }
                .frame(width: geo.size.height, height: geo.size.width)
                .rotationEffect(.degrees(90), anchor: .topLeading)
                .offset(x: geo.size.width)
                .tabViewStyle(.page(indexDisplayMode: .never))

                dots
            }
        }
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var dots: some View {
        VStack(spacing: 7) {
            ForEach(SessionMode.allCases) { mode in
                Capsule()
                    .fill(mode == selection ? NeonTheme.violet : NeonTheme.violet.opacity(0.3))
                    .frame(width: 7, height: mode == selection ? 20 : 7)
                    .shadow(color: mode == selection ? NeonTheme.violet.opacity(0.7) : .clear, radius: 6)
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.25), value: selection)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
        .padding(.trailing, 14)
        .allowsHitTesting(false)
    }

    private var footer: some View {
        VStack(spacing: 10) {
            if let onViewResults {
                Button(action: onViewResults) {
                    Label("Your results", systemImage: "doc.text.magnifyingglass")
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(NeonTheme.textPrimary)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .accessibilityHint("Shows assessments your clinician has released")
            }
            Text("Results are camera-based estimates that a clinician reviews.")
                .font(.footnote)
                .foregroundColor(NeonTheme.textDim)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, Theme.gutter)
        .padding(.top, 10)
        .padding(.bottom, 18)
        .background(NeonTheme.bgDeep)
    }
}

private struct ModePage: View {
    let mode: SessionMode
    let onChoose: () -> Void

    var body: some View {
        Button(action: onChoose) {
            ZStack {
                RadialGradient(
                    colors: [NeonTheme.bgGlow, NeonTheme.bgDeep],
                    center: mode == .clinic ? .topLeading : .bottomTrailing,
                    startRadius: 0, endRadius: 420
                )
                DotGrid()
                FloatingOrb(corner: mode == .clinic ? .topTrailing : .bottomLeading, color: NeonTheme.violet)
                VStack(spacing: 14) {
                    icon
                    Text(mode.title)
                        .font(NeonTypo.heading)
                        .foregroundColor(NeonTheme.textPrimary)
                    Text(mode.detail)
                        .font(NeonTypo.body)
                        .foregroundColor(NeonTheme.textDim)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 260)
                }
                .padding(28)
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Starts a session in \(mode.title)")
    }

    private var icon: some View {
        Circle()
            .fill(NeonTheme.violet.opacity(0.15))
            .overlay(Circle().strokeBorder(NeonTheme.violet.opacity(0.5), lineWidth: 1))
            .frame(width: 60, height: 60)
            .overlay(Image(systemName: mode.icon).font(.title2).foregroundColor(NeonTheme.violet))
            .shadow(color: NeonTheme.violet.opacity(0.4), radius: 14)
    }
}

/// A faint, slowly-drifting field of dots behind a mode panel, for depth
/// (spec §4.3). Static (not animated) under Reduce Motion.
private struct DotGrid: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = 0

    var body: some View {
        Canvas { context, size in
            let spacing: CGFloat = 16
            var y = -spacing + phase.truncatingRemainder(dividingBy: spacing)
            while y < size.height + spacing {
                var x = -spacing + phase.truncatingRemainder(dividingBy: spacing)
                while x < size.width + spacing {
                    context.fill(Path(ellipseIn: CGRect(x: x, y: y, width: 1.5, height: 1.5)), with: .color(NeonTheme.violet.opacity(0.35)))
                    x += spacing
                }
                y += spacing
            }
        }
        .opacity(0.5)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 6).repeatForever(autoreverses: false)) { phase = 32 }
        }
        .allowsHitTesting(false)
    }
}

/// A soft, slowly floating blurred circle in one corner of a mode panel, for
/// depth (spec §4.3). Static under Reduce Motion.
private struct FloatingOrb: View {
    enum Corner { case topTrailing, bottomLeading }
    let corner: Corner
    let color: Color

    @State private var floated = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 140, height: 140)
            .blur(radius: 30)
            .opacity(0.5)
            .offset(y: !reduceMotion && floated ? 14 : 0)
            .scaleEffect(!reduceMotion && floated ? 1.12 : 1)
            .animation(reduceMotion ? nil : .easeInOut(duration: 3).repeatForever(autoreverses: true), value: floated)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: corner == .topTrailing ? .topTrailing : .bottomLeading)
            .offset(x: corner == .topTrailing ? 30 : -20, y: corner == .topTrailing ? -30 : 30)
            .onAppear { floated = true }
            .allowsHitTesting(false)
    }
}
```

- [ ] **Step 2: Build to confirm it compiles**

```bash
cd apps/ios-client && xcodegen generate && xcodebuild -project PosturePulse.xcodeproj -scheme PosturePulse -destination 'id=55079423-C12B-40F0-979D-A182A2BD94E6' build
```
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Commit**

```bash
git add apps/ios-client/Sources/Session/ModeChooserView.swift
git commit -m "ios: rebuild the mode chooser as a vertical full-bleed neon pager"
```

---

### Task 5b: Fix the pager — replace the rotation trick with a direct drag gesture

**Found during on-device verification (Task 7):** the rotated-`TabView` vertical-pager technique from Task 5
did not swipe reliably on the real device — the owner reported it took more than one swipe to change pages
and the direction didn't match the intended mapping (swipe **up** → Patient, swipe **down** → Clinic). This
is exactly the risk flagged in Task 5's own notes ("genuinely needs on-device visual verification... if the
swipe direction or page sizing looks wrong once built, that's the moment to adjust"). Rather than keep tuning
rotation angles/anchors/offsets by trial and error, replace the technique entirely with a plain `DragGesture`
that directly controls a vertical offset — this makes the direction mapping an explicit, readable `if`
instead of an emergent property of a coordinate-space rotation hack.

**Files:**
- Modify: `apps/ios-client/Sources/Session/ModeChooserView.swift`

- [ ] **Step 1: Replace the `pager` computed property and its supporting state**

In `apps/ios-client/Sources/Session/ModeChooserView.swift`, replace the existing `pager` computed property
(the one using `GeometryReader { geo in ZStack { TabView(...)... } }` with the rotation/offset modifiers) with:

```swift
    @State private var dragOffset: CGFloat = 0

    private var pager: some View {
        GeometryReader { geo in
            let height = geo.size.height
            ZStack {
                VStack(spacing: 0) {
                    ModePage(mode: .clinic, onChoose: { onChoose(.clinic) })
                        .frame(height: height)
                    ModePage(mode: .patient, onChoose: { onChoose(.patient) })
                        .frame(height: height)
                }
                .offset(y: (selection == .clinic ? 0 : -height) + dragOffset)
                .gesture(
                    DragGesture(minimumDistance: 10)
                        .onChanged { value in
                            dragOffset = value.translation.height
                        }
                        .onEnded { value in
                            let threshold = height * 0.18
                            if value.translation.height < -threshold, selection == .clinic {
                                selection = .patient
                            } else if value.translation.height > threshold, selection == .patient {
                                selection = .clinic
                            }
                            withAnimation(.easeOut(duration: 0.3)) { dragOffset = 0 }
                        }
                )
                .animation(.easeOut(duration: 0.3), value: selection)

                dots
            }
            .clipped()
        }
    }
```

Direction check (so this is verifiable by reading, not just by feel): `DragGesture.Value.translation.height`
is `current.y - start.y` in screen coordinates, where y increases downward. A physical swipe **up** (finger
moves toward the top of the screen) therefore produces a **negative** `translation.height`. The `onEnded`
logic advances `.clinic -> .patient` when `translation.height < -threshold` (swipe up) and reverses
`.patient -> .clinic` when `translation.height > threshold` (swipe down) — matching "swipe up goes to Patient,
swipe down goes to Clinic" exactly as the owner specified. The `VStack` stacks Clinic above Patient, and a
`-height` offset (sliding the stack up) is what brings Patient into view — consistent with that same mapping,
not an arbitrary choice.

`ModeChooserView`'s existing `selection`, `dots`, `footer`, `ModePage`, `DotGrid`, `FloatingOrb` and the
overall `body` (`VStack(spacing: 0) { pager; footer }`) are UNCHANGED by this fix — only the `pager` property
gains the `dragOffset` state and loses the `TabView`/rotation implementation.

- [ ] **Step 2: Build to confirm it compiles**

```bash
cd apps/ios-client && xcodegen generate && xcodebuild -project PosturePulse.xcodeproj -scheme PosturePulse -destination 'id=55079423-C12B-40F0-979D-A182A2BD94E6' build
```
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Commit**

```bash
git add apps/ios-client/Sources/Session/ModeChooserView.swift
git commit -m "ios: replace the rotated-TabView pager with a direct drag gesture (fixes swipe direction/reliability)"
```

- [ ] **Step 4: Build to the connected device and have the owner re-verify** (same device/commands as Task 7)
  that a single swipe up reliably moves to Patient, a single swipe down reliably moves back to Clinic, and
  the dot indicator and footer still behave as before.

---

### Task 5c: Fix the pager's layout sizing (dots mispositioned, page possibly unreachable)

**Found from an on-device screenshot after Task 5b:** the page-indicator dot appeared pinned near the bottom
of the screen instead of vertically centered, and Patient mode wasn't reliably reachable by swiping. The root
cause: `pager`'s `ZStack` has no explicit frame of its own, so SwiftUI sizes it to fit its *tallest* child —
the draggable `VStack` of two `ModePage`s, which is `2 * height` tall (that's the whole point of the drag
mechanism: both pages exist stacked, only one is ever visible). Every other view composited into that same
`ZStack` — including `dots` — gets laid out relative to that oversized `2 * height` frame, not the single-page
viewport, which is why `dots` ends up centered on the midpoint of the *two-page* stack (exactly the boundary
between Clinic and Patient) rather than the center of whichever page is currently showing. `.clipped()` at the
end only clips *rendering*, not this layout-time sizing/positioning computation.

**Fix:** give the `ZStack` its own explicit `width`/`height` (exactly one page's dimensions, from
`GeometryReader`) *before* `.clipped()`, so every sibling inside it — `dots` included — lays out against the
correct single-page frame, while the oversized draggable `VStack` continues to work exactly as before (it's
allowed to overflow its parent's declared frame; `.clipped()` still crops what's actually drawn).

**Files:**
- Modify: `apps/ios-client/Sources/Session/ModeChooserView.swift`

- [ ] **Step 1: Add an explicit frame to the `pager`'s `ZStack`**

In `apps/ios-client/Sources/Session/ModeChooserView.swift`, change the `pager` computed property from:

```swift
    private var pager: some View {
        GeometryReader { geo in
            let height = geo.size.height
            ZStack {
                VStack(spacing: 0) {
                    ModePage(mode: .clinic, onChoose: { onChoose(.clinic) })
                        .frame(height: height)
                        .accessibilityHidden(selection != .clinic)
                    ModePage(mode: .patient, onChoose: { onChoose(.patient) })
                        .frame(height: height)
                        .accessibilityHidden(selection != .patient)
                }
                .offset(y: (selection == .clinic ? 0 : -height) + dragOffset)
                .gesture(
                    DragGesture(minimumDistance: 10)
                        .onChanged { value in
                            dragOffset = value.translation.height
                        }
                        .onEnded { value in
                            let threshold = height * 0.18
                            if value.translation.height < -threshold, selection == .clinic {
                                selection = .patient
                            } else if value.translation.height > threshold, selection == .patient {
                                selection = .clinic
                            }
                            withAnimation(.easeOut(duration: 0.3)) { dragOffset = 0 }
                        }
                )
                .animation(.easeOut(duration: 0.3), value: selection)

                dots
            }
            .clipped()
        }
    }
```

to:

```swift
    private var pager: some View {
        GeometryReader { geo in
            let height = geo.size.height
            ZStack {
                VStack(spacing: 0) {
                    ModePage(mode: .clinic, onChoose: { onChoose(.clinic) })
                        .frame(height: height)
                        .accessibilityHidden(selection != .clinic)
                    ModePage(mode: .patient, onChoose: { onChoose(.patient) })
                        .frame(height: height)
                        .accessibilityHidden(selection != .patient)
                }
                .offset(y: (selection == .clinic ? 0 : -height) + dragOffset)
                .gesture(
                    DragGesture(minimumDistance: 10)
                        .onChanged { value in
                            dragOffset = value.translation.height
                        }
                        .onEnded { value in
                            let threshold = height * 0.18
                            if value.translation.height < -threshold, selection == .clinic {
                                selection = .patient
                            } else if value.translation.height > threshold, selection == .patient {
                                selection = .clinic
                            }
                            withAnimation(.easeOut(duration: 0.3)) { dragOffset = 0 }
                        }
                )
                .animation(.easeOut(duration: 0.3), value: selection)

                dots
            }
            .frame(width: geo.size.width, height: height)
            .clipped()
        }
    }
```

(The only change: `.frame(width: geo.size.width, height: height)` is inserted between the `ZStack`'s closing
brace and `.clipped()`. Nothing else in the file changes.)

- [ ] **Step 2: Build to confirm it compiles**

```bash
cd apps/ios-client && xcodegen generate && xcodebuild -project PosturePulse.xcodeproj -scheme PosturePulse -destination 'id=55079423-C12B-40F0-979D-A182A2BD94E6' build
```
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Commit**

```bash
git add apps/ios-client/Sources/Session/ModeChooserView.swift
git commit -m "ios: constrain the pager ZStack to one page's frame (fixes dot position, page reachability)"
```

- [ ] **Step 4: Build to the connected device and have the owner re-verify** (same commands as Task 7/5b): the
  dot indicator should now sit roughly vertically centered on the trailing edge, and swiping up/down should
  reliably reach both Clinic and Patient pages.

---

### Task 6: Add `splash` and `mode-chooser` design-preview cases

**Files:**
- Modify: `apps/ios-client/Sources/App/BeAIveApp.swift`

- [ ] **Step 1: Add the two cases**

In `apps/ios-client/Sources/App/BeAIveApp.swift`, change the `DesignPreview` enum:

```swift
private enum DesignPreview: String {
    case report, capture, reps, setup, patients, results
    case reportMovement = "report-movement"
    case splash
    case modeChooser = "mode-chooser"
```

and add two cases to the `@ViewBuilder var view: some View { switch self { ... } }`:

```swift
        case .splash:
            SplashView(onFinished: {})
        case .modeChooser:
            ModeChooserView(onChoose: { _ in }, onViewResults: {})
```

(leave every existing case exactly as it is).

- [ ] **Step 2: Build and manually check both previews**

```bash
cd apps/ios-client && xcodegen generate && xcodebuild -project PosturePulse.xcodeproj -scheme PosturePulse -destination 'id=55079423-C12B-40F0-979D-A182A2BD94E6' build
```
Expected: `** BUILD SUCCEEDED **`. Then, on a booted simulator or the connected device:

```bash
xcrun simctl launch booted com.beaive.posturepulse -designPreview splash
# wait a moment, then:
xcrun simctl launch booted com.beaive.posturepulse -designPreview mode-chooser
```
(or, on the physical device, `xcrun devicectl device process launch --terminate-existing --device <udid> com.beaive.posturepulse -- -designPreview splash` / `mode-chooser`, as already used earlier this session).

- [ ] **Step 3: Commit**

```bash
git add apps/ios-client/Sources/App/BeAIveApp.swift
git commit -m "ios: add splash and mode-chooser design-preview cases"
```

---

### Task 7: Build to the connected device and verify

**Files:** none (verification task)

- [ ] **Step 1: Build and install to the connected iPhone**

```bash
cd apps/ios-client && xcodegen generate
xcodebuild -project PosturePulse.xcodeproj -scheme PosturePulse -destination 'id=00008020-001955940143002E' -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
APP=$(find ~/Library/Developer/Xcode/DerivedData/PosturePulse-*/Build/Products/Debug-iphoneos -maxdepth 1 -name "PosturePulse.app" | head -1)
xcrun devicectl device install app --device 00008020-001955940143002E "$APP"
xcrun devicectl device process launch --terminate-existing --device 00008020-001955940143002E com.beaive.posturepulse
```
Expected: `** BUILD SUCCEEDED **`, app installs and launches showing the new splash, then the new vertical
mode chooser.

- [ ] **Step 2: Manually verify against the approved mockups**

Check, on the real device:
- Splash: glow mark pulses, ring expands outward, ~1.2s, then the mode chooser appears.
- Mode chooser: swiping **up/down** (not left/right) moves between Clinic and Patient; the dot indicator on
  the right edge reflects the current page; "Your results" button and the disclaimer text are visible at the
  bottom regardless of which page is showing; tapping the visible page chooses that mode.
- If the swipe direction is inverted, or a page's content appears sideways/mis-sized: the rotation/offset
  values in `ModeChooserView.pager` (Task 5) need adjusting — this is the expected place to iterate, not a
  sign of a wrong approach.
- Start a Clinic-mode session and watch a capture step: the skeleton overlay should trace a smooth, curved,
  glowing mint-to-violet line over your body with gently pulsing joints, including elbows and wrists now.
- Toggle iOS Settings → Accessibility → Motion → Reduce Motion **on**, relaunch, and confirm: the splash ring
  doesn't expand (mark still shows, static), the mode-chooser dots still switch but don't animate the glow,
  and the skeleton's bones/joints stop pulsing and dashing (solid line, fixed joint size).

- [ ] **Step 3: Fix anything found, re-build, re-verify** (repeat Steps 1-2 until the device matches the
  approved mockups and the Reduce Motion fallback works)

---

### Task 8: Full test suite

**Files:** none (verification task)

- [ ] **Step 1: Run the full iOS test suite**

```bash
cd apps/ios-client && xcodebuild -project PosturePulse.xcodeproj -scheme PosturePulse -destination 'id=55079423-C12B-40F0-979D-A182A2BD94E6' test
```
Expected: `** TEST SUCCEEDED **`. All previously-passing tests still pass, plus the new
`testElbowAndWristJointsAreMappedForTheSkeletonOverlay` and the 5 new `SkeletonOverlayTests`.

- [ ] **Step 2: If anything regressed, fix it test-first and re-run** before considering this plan done.

- [ ] **Step 3: Final commit (only if Steps 1-7 left anything uncommitted)**

```bash
git status --short
# if clean, nothing to do; otherwise:
git add -A
git commit -m "ios: neon shell redesign part 1 - splash, mode chooser, capture skeleton"
```
