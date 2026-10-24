# Capture-Guidance Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the capture screen's blocking, over-strict "Level the phone" gate and boxed 4:5 preview with a looser tolerance, real distance guidance (LiDAR where available, frame-fill heuristic otherwise), a non-blocking top-toast HUD, and a full, proportionally-sized camera preview.

**Architecture:** `GuidanceEngine` (pure, unit-tested) gains a new `.tooFar` issue and a pure toast-selection function; a new optional `distanceMeters` reading flows in from the camera layer (real LiDAR sample when the device has it, `nil` otherwise, in which case the engine falls back to a frame-fill heuristic computed from the pose it already has). `ClipRecorder` gets an additive, best-effort LiDAR depth probe wired the same defensive way its existing AVFoundation setup already is (`guard`/`if let`, never throws, never blocks recording). `GuidedCaptureView` swaps the boxed preview + old `LevelIndicator` + bottom capsule for a full-bleed proportional preview with a single non-blocking top toast.

**Tech Stack:** Swift, SwiftUI, AVFoundation (`AVCaptureDepthDataOutput`), XCTest. Schema: `packages/schemas/src/assessment-battery.schema.json` + its generated TS output + the `references/assessment-battery.v0-draft.json` fixture the backend serves.

**Scope note:** This plan does **not** reskin `GuidedCaptureView`'s chrome (step track, instruction text, stop button) to the dark neon theme used elsewhere in the app. The approved mockups used a dark background only to show the HUD clearly; retheming the whole capture screen is a separate visual decision nobody has asked for. Only the preview sizing, the guidance toast, and the underlying engine logic change here.

---

### Task 1: Loosen level tolerance from 3° to 6°

**Files:**
- Modify: `packages/schemas/src/assessment-battery.schema.json:28`
- Modify: `references/assessment-battery.v0-draft.json` (4 occurrences, lines 14/34/55/76)
- Modify: `apps/ios-client/Sources/Assessment/AssessmentBattery.swift:63,71`
- Test: `services/backend-api/src/battery/battery.service.spec.ts` (read first — confirm it doesn't assert the literal `3`)

- [ ] **Step 1: Check the backend test doesn't hardcode the old tolerance**

Run: `grep -n "levelToleranceDegrees\|3" services/backend-api/src/battery/battery.service.spec.ts`

If it asserts `levelToleranceDegrees` equals `3` anywhere, update that assertion to `6` in the same edit as Step 2.

- [ ] **Step 2: Update the schema default**

In `packages/schemas/src/assessment-battery.schema.json:28`, change:
```json
"levelToleranceDegrees": { "type": "number", "exclusiveMinimum": 0, "default": 3 },
```
to:
```json
"levelToleranceDegrees": { "type": "number", "exclusiveMinimum": 0, "default": 6 },
```

- [ ] **Step 3: Regenerate schema output**

Run (prepend the codegen venv if `datamodel-code-generator` isn't on PATH):
```bash
npm run schemas:generate && npm run schemas:check
```
Expected: both succeed, generated TS/Python output updates to reflect `default: 6`.

- [ ] **Step 4: Update the reference battery fixture**

In `references/assessment-battery.v0-draft.json`, change all four `"levelToleranceDegrees": 3,` occurrences (lines 14, 34, 55, 76) to `"levelToleranceDegrees": 6,`.

- [ ] **Step 5: Update the iOS fallback defaults**

In `apps/ios-client/Sources/Assessment/AssessmentBattery.swift:63`, change:
```swift
levelToleranceDegrees = try c.decodeIfPresent(Double.self, forKey: .levelToleranceDegrees) ?? 3
```
to:
```swift
levelToleranceDegrees = try c.decodeIfPresent(Double.self, forKey: .levelToleranceDegrees) ?? 6
```

At line 71, change the `#if DEBUG` init's default parameter:
```swift
minFps: Double = 24, levelToleranceDegrees: Double = 3, modes: [SessionMode] = [.clinic, .patient],
```
to:
```swift
minFps: Double = 24, levelToleranceDegrees: Double = 6, modes: [SessionMode] = [.clinic, .patient],
```

- [ ] **Step 6: Run the affected test suites**

```bash
cd services/backend-api && npx jest battery
cd /path/to/repo && npm run lint:claims
```
Expected: all pass. (`lint:claims` because this touches `references/*.json`, per CLAUDE.md.)

- [ ] **Step 7: Commit**

```bash
git add packages/schemas/src/assessment-battery.schema.json packages/schemas/generated \
  references/assessment-battery.v0-draft.json apps/ios-client/Sources/Assessment/AssessmentBattery.swift
git commit -m "feat: loosen level-gate tolerance from 3° to 6° for handheld use

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Add a `pitchDegrees` reading and a `.tooFar` guidance issue

**Files:**
- Modify: `apps/ios-client/Sources/Assessment/GuidanceEngine.swift`
- Test: `apps/ios-client/Tests/GuidanceEngineTests.swift`

- [ ] **Step 1: Write the failing tests**

Add to `GuidanceEngineTests.swift` (inside the `GuidanceEngineTests` class, near the other level/framing tests):

```swift
func testPitchDegreesIsExposedOnStatus() {
    let pitched = CameraGravity.normalised([0, cos(2 * Double.pi / 180), sin(2 * Double.pi / 180)])!
    let s = feed(engine(.anterior), facingPose(), gravity: pitched, to: 0.3)
    XCTAssertNotNil(s.pitchDegrees)
}

/// A person who fills only a small fraction of the frame (head-to-ankle span
/// well under half the image height) but is still fully inside the margins.
private func distantPose(span: Double = 0.2) -> BodyPose2D {
    let top = 0.4, bottom = top + span
    return BodyPose2D(joints: [
        .nose: .init(x: 0.50, y: top, confidence: 0.9),
        .leftEar: .init(x: 0.51, y: top + 0.01, confidence: 0.9),
        .rightEar: .init(x: 0.49, y: top + 0.01, confidence: 0.9),
        .leftShoulder: .init(x: 0.53, y: top + span * 0.18, confidence: 0.9),
        .rightShoulder: .init(x: 0.47, y: top + span * 0.18, confidence: 0.9),
        .leftHip: .init(x: 0.52, y: top + span * 0.5, confidence: 0.9),
        .rightHip: .init(x: 0.48, y: top + span * 0.5, confidence: 0.9),
        .leftKnee: .init(x: 0.52, y: top + span * 0.72, confidence: 0.9),
        .rightKnee: .init(x: 0.48, y: top + span * 0.72, confidence: 0.9),
        .leftAnkle: .init(x: 0.52, y: bottom, confidence: 0.9),
        .rightAnkle: .init(x: 0.48, y: bottom, confidence: 0.9),
    ])
}

func testAPersonTooFarAwayIsFlaggedEvenThoughFullyFramed() {
    let s = feed(engine(.anterior), distantPose(span: 0.2), to: 1)
    XCTAssertEqual(s.issues.first, .tooFar)
    XCTAssertFalse(s.shouldStartRecording)
}

func testANormallyFramedPersonIsNotFlaggedAsTooFar() {
    // facingPose() spans y 0.15...0.88, well above the too-far threshold.
    let s = feed(engine(.anterior), facingPose(), to: 0.8)
    XCTAssertFalse(s.issues.contains(.tooFar))
}

func testTooFarOutranksViewAndStillnessButNotFramingOrLevel() {
    XCTAssertEqual(GuidanceIssue.allCases.firstIndex(of: .tooFar), 2)
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/ios-client && xcodebuild test -scheme PosturePulse -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:PosturePulseTests/GuidanceEngineTests 2>&1 | tail -40`

Expected: FAIL — `pitchDegrees` doesn't exist on `GuidanceStatus`, `.tooFar` doesn't exist on `GuidanceIssue`.

- [ ] **Step 3: Implement**

In `GuidanceEngine.swift`, update `GuidanceIssue` (keep `.cameraNotLevel` first, insert `.tooFar` right after it — distance matters before framing/view/stillness, since a too-far reading makes the other checks unreliable):

```swift
enum GuidanceIssue: CaseIterable, Equatable {
    case cameraNotLevel
    case tooFar
    case noPerson
    case outOfFrame
    case wrongView
    case moving

    /// Instruction for the person; never contains a number.
    func prompt(for view: StepView) -> String {
        switch self {
        case .cameraNotLevel: return "Level the phone"
        case .tooFar: return "Come a bit closer"
        case .noPerson: return "Step into the frame"
        case .outOfFrame: return "Step back so your whole body is in view"
        case .wrongView:
            switch view {
            case .anterior: return "Face the camera"
            case .posterior: return "Turn your back to the camera"
            case .leftLateral: return "Turn so your left side faces the camera"
            case .rightLateral: return "Turn so your right side faces the camera"
            }
        case .moving: return "Hold still"
        }
    }
}
```

Update `GuidanceStatus` to add `pitchDegrees` and `distanceMeters` (the latter is plumbed through now so Task 3 doesn't need to touch this struct again):

```swift
struct GuidanceStatus: Equatable {
    var issues: [GuidanceIssue]
    var isLevel: Bool
    /// Image roll against true vertical, for the bubble level only.
    var rollDegrees: Double?
    /// Image pitch against true vertical, for the tilt toast only.
    var pitchDegrees: Double?
    /// 0...1 progress through the ready hold before recording starts.
    var readyProgress: Double
    var shouldStartRecording: Bool
}
```

Add a `distanceMeters` field to `GuidanceSample` (defaulted so no call site breaks):

```swift
struct GuidanceSample {
    let time: TimeInterval
    let pose: BodyPose2D?
    /// Unit gravity in the camera frame of the oriented image; nil when motion is unavailable.
    let cameraGravity: [Double]?
    /// LiDAR-derived distance to the subject in metres, when the device has a
    /// LiDAR sensor and a reading was available for this frame; nil otherwise,
    /// in which case GuidanceEngine falls back to a frame-fill estimate.
    let distanceMeters: Double?

    init(time: TimeInterval, pose: BodyPose2D?, cameraGravity: [Double]?, distanceMeters: Double? = nil) {
        self.time = time
        self.pose = pose
        self.cameraGravity = cameraGravity
        self.distanceMeters = distanceMeters
    }
}
```

Add new tunable constants near the other guidance constants (`edgeMargin`, etc.):

```swift
/// Head-to-ankle span under this fraction of the frame height reads as "too
/// far" when no LiDAR distance reading is available. Guidance-only, not a
/// measurement threshold - tune freely without touching the analysis pipeline.
let tooFarSpanFraction: Double = 0.35
/// LiDAR-only: distance beyond this reads as "too far".
let tooFarDistanceMeters: Double = 3.0
```

In `update(_:)`, compute `pitchDegrees` and insert the `.tooFar` check right after the level check (before the pose/framing block):

```swift
func update(_ sample: GuidanceSample) -> GuidanceStatus {
    var issues: [GuidanceIssue] = []

    let roll = sample.cameraGravity.map(CameraGravity.rollDegrees)
    let pitch = sample.cameraGravity.map(CameraGravity.pitchDegrees)
    let isLevel = roll.map { abs($0) <= levelToleranceDegrees } == true
        && pitch.map { $0 <= levelToleranceDegrees } == true
    if !isLevel { issues.append(.cameraNotLevel) }

    if isTooFar(sample) { issues.append(.tooFar) }

    if let pose = sample.pose, pose.joints.values.filter({ $0.confidence >= minConfidence }).count >= 4 {
        if !isFramed(pose) {
            issues.append(.outOfFrame)
            hipHistory = []
        } else {
            if !matchesView(pose) { issues.append(.wrongView) }
            if !isStill(pose, at: sample.time) { issues.append(.moving) }
        }
    } else {
        issues.append(.noPerson)
        hipHistory = []
    }

    var progress = 0.0
    var start = false
    if issues.isEmpty {
        let since = readySince ?? sample.time
        readySince = since
        progress = min((sample.time - since) / readyHold, 1)
        start = sample.time - since >= readyHold - 1e-9
    } else {
        readySince = nil
    }
    return GuidanceStatus(issues: issues, isLevel: isLevel, rollDegrees: roll, pitchDegrees: pitch, readyProgress: progress, shouldStartRecording: start)
}
```

Add the `isTooFar` rule next to the other rule methods (near `isFramed`):

```swift
/// LiDAR distance when available (more precise); otherwise a frame-fill
/// estimate from the pose's head-to-ankle span. Never flags "too far" when
/// there's no pose at all - that's .noPerson's job, not this one's.
private func isTooFar(_ sample: GuidanceSample) -> Bool {
    if let distance = sample.distanceMeters { return distance > tooFarDistanceMeters }
    guard let pose = sample.pose, let head = head(pose) else { return false }
    let ankles = [ok(pose.joints[.leftAnkle]), ok(pose.joints[.rightAnkle])].compactMap { $0 }
    guard !ankles.isEmpty else { return false }
    let ankleY = ankles.map(\.y).reduce(0, +) / Double(ankles.count)
    let span = abs(ankleY - head.y)
    return span < tooFarSpanFraction
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the same `xcodebuild test` command as Step 2.
Expected: PASS, and the existing `testPromptsNeverContainANumber` test still passes (new `.tooFar` prompt has no digits).

- [ ] **Step 5: Commit**

```bash
git add apps/ios-client/Sources/Assessment/GuidanceEngine.swift apps/ios-client/Tests/GuidanceEngineTests.swift
git commit -m "feat: add a .tooFar guidance issue with LiDAR/frame-fill distance checks

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Pure toast selection (icon + directional text)

**Files:**
- Modify: `apps/ios-client/Sources/Assessment/GuidanceEngine.swift`
- Test: `apps/ios-client/Tests/GuidanceEngineTests.swift`

- [ ] **Step 1: Write the failing tests**

Append to `GuidanceEngineTests.swift`:

```swift
func testNoToastWhenThereAreNoIssues() {
    let status = GuidanceStatus(issues: [], isLevel: true, rollDegrees: 0, pitchDegrees: 0, readyProgress: 0.5, shouldStartRecording: false)
    XCTAssertNil(CaptureToast.forStatus(status, view: .anterior))
}

func testLevelToastPointsInTheDirectionOfRoll() {
    let rolledRight = GuidanceStatus(issues: [.cameraNotLevel], isLevel: false, rollDegrees: 8, pitchDegrees: 0, readyProgress: 0, shouldStartRecording: false)
    let toast = try! XCTUnwrap(CaptureToast.forStatus(rolledRight, view: .anterior))
    XCTAssertTrue(toast.text.lowercased().contains("left"), toast.text)

    let rolledLeft = GuidanceStatus(issues: [.cameraNotLevel], isLevel: false, rollDegrees: -8, pitchDegrees: 0, readyProgress: 0, shouldStartRecording: false)
    let toast2 = try! XCTUnwrap(CaptureToast.forStatus(rolledLeft, view: .anterior))
    XCTAssertTrue(toast2.text.lowercased().contains("right"), toast2.text)
}

func testLevelToastFallsBackToGenericTextWhenRollIsUnknown() {
    let status = GuidanceStatus(issues: [.cameraNotLevel], isLevel: false, rollDegrees: nil, pitchDegrees: nil, readyProgress: 0, shouldStartRecording: false)
    let toast = try! XCTUnwrap(CaptureToast.forStatus(status, view: .anterior))
    XCTAssertEqual(toast.text, GuidanceIssue.cameraNotLevel.prompt(for: .anterior))
}

func testNonLevelIssuesUseTheirPlainPrompt() {
    for issue: GuidanceIssue in [.tooFar, .noPerson, .outOfFrame, .moving] {
        let status = GuidanceStatus(issues: [issue], isLevel: true, rollDegrees: 0, pitchDegrees: 0, readyProgress: 0, shouldStartRecording: false)
        let toast = try! XCTUnwrap(CaptureToast.forStatus(status, view: .anterior))
        XCTAssertEqual(toast.text, issue.prompt(for: .anterior))
    }
}

func testEveryToastHasANonEmptyIcon() {
    for issue in GuidanceIssue.allCases {
        let status = GuidanceStatus(issues: [issue], isLevel: issue != .cameraNotLevel, rollDegrees: 5, pitchDegrees: 0, readyProgress: 0, shouldStartRecording: false)
        let toast = try! XCTUnwrap(CaptureToast.forStatus(status, view: .anterior))
        XCTAssertFalse(toast.icon.isEmpty)
    }
}
```

- [ ] **Step 2: Run to verify failure**

Same `xcodebuild test` command as Task 2. Expected: FAIL — `CaptureToast` doesn't exist.

- [ ] **Step 3: Implement**

Add to the bottom of `GuidanceEngine.swift`:

```swift
/// A single non-blocking HUD message: one SF Symbol + one short phrase.
/// Pure and SwiftUI-free so it's directly testable.
struct CaptureToast: Equatable {
    let icon: String
    let text: String

    /// The single most important issue's toast, or nil when there's nothing to say.
    static func forStatus(_ status: GuidanceStatus, view: StepView) -> CaptureToast? {
        guard let issue = status.issues.first else { return nil }
        if issue == .cameraNotLevel, let roll = status.rollDegrees, abs(roll) > 0.01 {
            // Vision/image-frame roll: positive rolls the top toward image-right,
            // so the correction is "tilt left" to bring it back level.
            let direction = roll > 0 ? "left" : "right"
            return CaptureToast(icon: "iphone.gen3", text: "Tilt \(direction) a little")
        }
        return CaptureToast(icon: icon(for: issue), text: issue.prompt(for: view))
    }

    private static func icon(for issue: GuidanceIssue) -> String {
        switch issue {
        case .cameraNotLevel: return "iphone.gen3"
        case .tooFar: return "arrow.down.right.and.arrow.up.left"
        case .noPerson: return "person.fill.viewfinder"
        case .outOfFrame: return "arrow.up.left.and.arrow.down.right"
        case .wrongView: return "arrow.triangle.2.circlepath"
        case .moving: return "hand.raised.fill"
        }
    }
}
```

- [ ] **Step 4: Run to verify pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios-client/Sources/Assessment/GuidanceEngine.swift apps/ios-client/Tests/GuidanceEngineTests.swift
git commit -m "feat: add CaptureToast, a pure icon+text selector for capture guidance

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: LiDAR depth probe in ClipRecorder (best-effort, additive)

**Files:**
- Modify: `apps/ios-client/Sources/Capture/ClipRecorder.swift`

**Context for the implementer:** This task has no automated test — like the rest of `ClipRecorder`, it needs a real device and is covered by the comment at the top of the file ("Needs a real device; the logic it feeds ... is unit-tested"). The logic it feeds (`GuidanceEngine.isTooFar`, Task 2) is already fully unit tested with `distanceMeters` injected directly, so this task is purely about wiring a real reading into that existing, tested path. The test device for this project (iPhone XR) has **no LiDAR**, so this task's main user-facing effect on that device is: nothing changes, the frame-fill fallback from Task 2 keeps doing the work. Correctness of the LiDAR path itself can only be confirmed on a LiDAR-equipped device (iPhone 12 Pro or later); until then, treat it as best-effort and make sure every step is guarded so a failure anywhere in this path silently falls back to "no depth reading" rather than breaking the camera or recording.

- [ ] **Step 1: Add the depth output, guarded, alongside the existing video output**

In `ClipRecorder.swift`, add a new property near the other output/queue properties:

```swift
private let depthOutput = AVCaptureDepthDataOutput()
private let depthQueue = DispatchQueue(label: "com.beaive.clip.depth")
/// Smoothed by taking the latest sample only; read on captureQueue via the delegate callback.
private(set) var latestDistanceMeters: Double?
```

At the end of `configure(_:)` (after the existing video-connection setup, same method, same `session.beginConfiguration()`/`commitConfiguration()` pair already open), add:

```swift
// LiDAR depth, best-effort: only on Pro-model devices that have it. Every
// step is guarded so a failure here never affects the video/recording path
// already configured above.
if let depthDevice = AVCaptureDevice.default(.builtInLiDARDepthCamera, for: .depthData, position: .back),
   let depthInput = try? AVCaptureDeviceInput(device: depthDevice),
   session.canAddInput(depthInput), session.canAddOutput(depthOutput) {
    session.addInput(depthInput)
    session.addOutput(depthOutput)
    depthOutput.isFilteringEnabled = true
    depthOutput.setDelegate(self, callbackQueue: depthQueue)
}
```

- [ ] **Step 2: Conform to `AVCaptureDepthDataOutputDelegate`**

Add a new extension at the bottom of the file:

```swift
extension ClipRecorder: AVCaptureDepthDataOutputDelegate {
    func depthDataOutput(_ output: AVCaptureDepthDataOutput, didOutput depthData: AVDepthData, timestamp: CMTime, connection: AVCaptureConnection) {
        let converted = depthData.depthDataType == kCVPixelFormatType_DepthFloat32
            ? depthData
            : depthData.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32)
        let pixelBuffer = converted.depthDataMap
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else { return }
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        guard width > 0, height > 0 else { return }
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        let centerRow = base.advanced(by: (height / 2) * bytesPerRow).assumingMemoryBound(to: Float32.self)
        let centerDistance = centerRow[width / 2]
        guard centerDistance.isFinite, centerDistance > 0 else { return }
        captureQueue.async { [weak self] in self?.latestDistanceMeters = Double(centerDistance) }
    }
}
```

- [ ] **Step 3: Feed the reading into `GuidanceSample`**

In `captureOutput(_:didOutput:from:)`, find the existing construction of `GuidanceSample` and pass the new reading through:

```swift
visionQueue.async { [weak self] in
    guard let self else { return }
    let pose = self.poseDetector.detect(in: pixels)
    let distance = self.latestDistanceMeters
    self.captureQueue.async { self.visionBusy = false }
    DispatchQueue.main.async {
        self.imageSize = size
        self.onGuidanceSample?(GuidanceSample(time: time, pose: pose, cameraGravity: cameraGravity, distanceMeters: distance))
    }
}
```

- [ ] **Step 4: Build**

Run: `cd apps/ios-client && xcodebuild build -scheme PosturePulse -destination 'platform=iOS Simulator,name=iPhone 15' 2>&1 | tail -40`
Expected: `BUILD SUCCEEDED`. (The simulator has no LiDAR, so this only verifies compilation — the depth input/output `if let` simply never activates there, which is correct and expected.)

- [ ] **Step 5: Commit**

```bash
git add apps/ios-client/Sources/Capture/ClipRecorder.swift
git commit -m "feat: add best-effort LiDAR depth probe for distance guidance

Additive to the existing capture session; every step is guarded so devices
without LiDAR (e.g. the iPhone XR this app is tested on) are unaffected and
GuidanceEngine's frame-fill fallback (Task 2) does the work instead.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Full-bleed proportional preview + top-toast HUD

**Files:**
- Modify: `apps/ios-client/Sources/Session/GuidedCaptureView.swift`
- Modify: `apps/ios-client/Sources/Session/BatteryView.swift`
- Modify: `apps/ios-client/Sources/Assessment/BatteryRunner.swift`

- [ ] **Step 1: Carry `pitchDegrees` through `BatteryRunner`**

No code change needed — `BatteryRunner.guidance` is already the full `GuidanceStatus` published property (`Sources/Assessment/BatteryRunner.swift:52`), so `runner.guidance?.pitchDegrees` and `CaptureToast.forStatus(status, view:)` are both already reachable from `BatteryView`. Confirm this by reading `BatteryRunner.swift:50-55` before continuing.

- [ ] **Step 2: Replace `CaptureState`'s guidance fields with the new toast**

In `GuidedCaptureView.swift`, replace the `CaptureState` struct's guidance-related fields:

```swift
struct CaptureState: Equatable {
    var stepIndex: Int
    var instruction: String
    var detail: String
    /// The single most important guidance message right now, or nil when
    /// nothing needs correcting. Shown as a non-blocking top banner, never
    /// a full-screen block.
    var toast: CaptureToast?
    /// 0...1 progress of the current hold; nil for rep-based steps.
    var holdProgress: Double?
    var repCount: Int?
    var repTarget: Int?
    /// Shown only while actually recording (separate from `toast`, which is
    /// pre-recording guidance only).
    var recordingPrompt: String?
}
```

- [ ] **Step 3: Rebuild the stage layout: full-bleed preview, top toast, no `LevelIndicator`**

Replace the `body` of `GuidedCaptureView` with:

```swift
var body: some View {
    VStack(spacing: 16) {
        StepTrack(steps: steps, current: state.stepIndex)
            .padding(.top, 8)

        VStack(alignment: .leading, spacing: 6) {
            Text(state.instruction)
                .font(Typo.title)
                .foregroundColor(Theme.ink)
            Text(state.detail)
                .font(.callout)
                .foregroundColor(Theme.inkSoft)
        }
        .frame(maxWidth: .infinity, alignment: .leading)

        GeometryReader { geo in
            ZStack {
                stage()
                FramingBrackets()
                    .stroke(Theme.readoutText.opacity(0.85), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .padding(12)

                VStack {
                    HStack {
                        statusRow
                        Spacer()
                        progressBadge
                    }
                    if let toast = state.toast {
                        CaptureGuidanceToast(toast: toast)
                            .padding(.top, 10)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                    Spacer()
                    if let prompt = state.recordingPrompt {
                        Label(prompt, systemImage: "record.circle")
                            .font(.subheadline.weight(.semibold))
                            .foregroundColor(Theme.ink)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(Capsule().fill(.white))
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .padding(16)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        // Nothing is ever cropped from what the pipeline sees - the frame just
        // fills nearly all available space instead of a boxed 4:5 rectangle.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.readout)
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .animation(.easeOut(duration: 0.25), value: state.toast)
        .animation(.easeOut(duration: 0.25), value: state.recordingPrompt)

        stop()
    }
    .padding(.horizontal, Theme.gutter)
        .readableColumn()
    .padding(.bottom, 12)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .paperBackground()
}

private var statusRow: some View {
    // Replaces the old LevelIndicator bubble: a quiet status dot, no text
    // duplicating what the toast already says when something's wrong.
    Circle()
        .fill(state.toast == nil ? Theme.readoutText : Theme.readoutAccent)
        .frame(width: 10, height: 10)
        .padding(10)
        .background(Capsule().fill(Theme.readout.opacity(0.75)))
        .accessibilityLabel(state.toast == nil ? "Ready" : "Needs adjustment")
}
```

Remove the `aspectRatio(3 / 4, contentMode: .fit)` line entirely (it's superseded by the `GeometryReader`/`frame(maxWidth:maxHeight:)` above) and delete the now-unused `private struct LevelIndicator` block.

- [ ] **Step 4: Add the `CaptureGuidanceToast` view**

Add this new `private struct` to `GuidedCaptureView.swift`, next to `HoldRing`:

```swift
/// Non-blocking top banner for the single most important guidance issue.
/// Never covers the skeleton or the hold-ring.
private struct CaptureGuidanceToast: View {
    let toast: CaptureToast

    var body: some View {
        Label(toast.text, systemImage: toast.icon)
            .font(.subheadline.weight(.semibold))
            .foregroundColor(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Capsule().fill(Color.black.opacity(0.55)))
            .accessibilityElement(children: .combine)
    }
}
```

- [ ] **Step 5: Update `BatteryView.capture` to build the new `CaptureState`**

In `BatteryView.swift`, replace the `.init(...)` passed to `GuidedCaptureView`:

```swift
private var capture: some View {
    let step = runner.currentStep
    let recording = runner.phase == .recording
    let toast = recording ? nil : runner.guidance.flatMap { CaptureToast.forStatus($0, view: step?.view ?? .anterior) }
    return GuidedCaptureView(
        steps: stepTitles,
        state: .init(
            stepIndex: runner.stepIndex,
            instruction: step?.title ?? "",
            detail: step?.instruction ?? "",
            toast: toast,
            holdProgress: recording ? runner.holdProgress : nil,
            repCount: nil,
            repTarget: nil,
            recordingPrompt: recording ? "Recording - hold still" : nil
        ),
        stage: {
            ZStack {
                if let recorder { CameraPreviewView(session: recorder.session) }
                SkeletonOverlay(pose: runner.pose, imageSize: runner.imageSize)
                TorchButton(torch: torch)
            }
        },
        stop: { stopButton }
    )
}
```

- [ ] **Step 6: Build and run the iOS test suite**

```bash
cd apps/ios-client
xcodebuild build -scheme PosturePulse -destination 'platform=iOS Simulator,name=iPhone 15' 2>&1 | tail -40
xcodebuild test -scheme PosturePulse -destination 'platform=iOS Simulator,name=iPhone 15' 2>&1 | tail -60
```
Expected: `BUILD SUCCEEDED`, full suite green (baseline 116 + the new tests from Tasks 2-3).

- [ ] **Step 7: Check the `-designPreview` cases still compile**

Run: `grep -n "GuidedCaptureView\|CaptureState" apps/ios-client/Sources/App/BeAIveApp.swift`

If a `DesignPreview` case constructs a `CaptureState` directly, update it to the new field names (`toast`/`recordingPrompt` instead of `tiltDegrees`/`isLevel`/`qualityPrompt`).

- [ ] **Step 8: Commit**

```bash
git add apps/ios-client/Sources/Session/GuidedCaptureView.swift apps/ios-client/Sources/Session/BatteryView.swift apps/ios-client/Sources/App/BeAIveApp.swift
git commit -m "feat: full-bleed proportional capture preview with non-blocking toast HUD

Replaces the boxed 4:5 preview and the old blocking LevelIndicator/bottom
capsule with a GeometryReader-sized preview (scales on iPad too) and a
single top-banner toast driven by CaptureToast.forStatus.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full iOS suite**

```bash
cd apps/ios-client && xcodebuild test -scheme PosturePulse -destination 'platform=iOS Simulator,name=iPhone 15' 2>&1 | tail -80
```
Expected: all green, no regressions in `SkeletonOverlayTests`, `VisionJointMappingTests`, or any other existing suite.

- [ ] **Step 2: Backend + schema checks**

```bash
cd services/backend-api && npx jest
npm run schemas:check
npm run lint:claims
```
Expected: all pass.

- [ ] **Step 3: Manual on-device check (required before calling this done)**

Build to the iPhone XR (`scripts/` build flow already used earlier this session) and confirm, per the spec's testing section:
- The level toast tolerates small handheld sway and shows a directional "Tilt left/right" message, not a static "Level the phone" that never clears.
- Standing far from the phone shows "Come a bit closer" (frame-fill fallback, since the XR has no LiDAR).
- The preview fills nearly the whole screen with no boxed rectangle.
- The skeleton overlay, framing brackets, and hold-ring are all still visible and correctly positioned.

This step cannot be automated — note the result back to the user, it is not optional per the spec's own testing section (`docs/superpowers/specs/2026-10-24-capture-guidance-redesign-design.md`).
