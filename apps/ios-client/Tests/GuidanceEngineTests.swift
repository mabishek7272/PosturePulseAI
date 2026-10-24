import XCTest
@testable import PostureAnalysisClient

final class GuidanceEngineTests: XCTestCase {
    private typealias J = BodyPose2D.Joint
    private let level: [Double] = [0, 1, 0]
    private let size = CGSize(width: 1080, height: 1920)

    /// Standing person facing the camera, normalised top-left image coordinates.
    /// The person's left side appears on image right.
    private func facingPose(hipDx: Double = 0, confidence: Double = 0.9) -> BodyPose2D {
        BodyPose2D(joints: [
            .nose: .init(x: 0.50, y: 0.15, confidence: confidence),
            .leftEar: .init(x: 0.53, y: 0.14, confidence: confidence),
            .rightEar: .init(x: 0.47, y: 0.14, confidence: confidence),
            .leftShoulder: .init(x: 0.58, y: 0.25, confidence: confidence),
            .rightShoulder: .init(x: 0.42, y: 0.25, confidence: confidence),
            .leftHip: .init(x: 0.55 + hipDx, y: 0.50, confidence: confidence),
            .rightHip: .init(x: 0.45 + hipDx, y: 0.50, confidence: confidence),
            .leftKnee: .init(x: 0.55, y: 0.70, confidence: confidence),
            .rightKnee: .init(x: 0.45, y: 0.70, confidence: confidence),
            .leftAnkle: .init(x: 0.55, y: 0.88, confidence: confidence),
            .rightAnkle: .init(x: 0.45, y: 0.88, confidence: confidence),
        ])
    }

    /// The same person seen from behind: left and right swap sides in the image.
    private func backPose() -> BodyPose2D {
        var pose = facingPose()
        for (l, r) in [(J.leftEar, J.rightEar), (.leftShoulder, .rightShoulder), (.leftHip, .rightHip), (.leftKnee, .rightKnee), (.leftAnkle, .rightAnkle)] {
            let a = pose.joints[l]!, b = pose.joints[r]!
            pose.joints[l] = b
            pose.joints[r] = a
        }
        pose.joints[.nose] = .init(x: 0.5, y: 0.15, confidence: 0.2)
        return pose
    }

    /// Side-on: the named side is nearer the camera (more confident), shoulders overlap.
    private func sidePose(near: BodyPose2D.Side) -> BodyPose2D {
        let nearC = 0.9, farC = 0.35
        let l = near == .left ? nearC : farC, r = near == .left ? farC : nearC
        return BodyPose2D(joints: [
            .nose: .init(x: 0.46, y: 0.15, confidence: 0.9),
            .leftEar: .init(x: 0.50, y: 0.14, confidence: l),
            .rightEar: .init(x: 0.50, y: 0.14, confidence: r),
            .leftShoulder: .init(x: 0.50, y: 0.25, confidence: l),
            .rightShoulder: .init(x: 0.51, y: 0.25, confidence: r),
            .leftHip: .init(x: 0.50, y: 0.50, confidence: l),
            .rightHip: .init(x: 0.505, y: 0.50, confidence: r),
            .leftKnee: .init(x: 0.50, y: 0.70, confidence: l),
            .rightKnee: .init(x: 0.505, y: 0.70, confidence: r),
            .leftAnkle: .init(x: 0.50, y: 0.88, confidence: l),
            .rightAnkle: .init(x: 0.505, y: 0.88, confidence: r),
        ])
    }

    private func engine(_ view: StepView) -> GuidanceEngine {
        GuidanceEngine(view: view, levelToleranceDegrees: 3, imageSize: size)
    }

    /// Feeds samples every 0.1 s from t0 to t1 and returns the last status.
    @discardableResult
    private func feed(_ engine: GuidanceEngine, _ pose: BodyPose2D?, gravity: [Double]? = [0, 1, 0], from t0: Double = 0, to t1: Double) -> GuidanceStatus {
        var status = engine.update(.init(time: t0, pose: pose, cameraGravity: gravity))
        var t = t0 + 0.1
        while t <= t1 + 1e-9 {
            status = engine.update(.init(time: t, pose: pose, cameraGravity: gravity))
            t += 0.1
        }
        return status
    }

    func testPoseRunsOnEveryThirdFrame() {
        XCTAssertEqual((0..<9).filter(GuidanceEngine.shouldDetectPose(frameIndex:)), [0, 3, 6])
    }

    func testStartsRecordingOnlyAfterOneAndAHalfSecondsOfReady() {
        let e = engine(.anterior)
        var startedAt: Double?
        var t = 0.0
        while t < 4, startedAt == nil {
            let s = e.update(.init(time: t, pose: facingPose(), cameraGravity: level))
            if s.shouldStartRecording { startedAt = t }
            t += 0.1
        }
        let start = try! XCTUnwrap(startedAt)
        XCTAssertGreaterThanOrEqual(start, 1.5)
        XCTAssertLessThan(start, 2.6)
    }

    func testReadyStatusHasNoIssues() {
        let s = feed(engine(.anterior), facingPose(), to: 0.8)
        XCTAssertEqual(s.issues, [])
        XCTAssertTrue(s.isLevel)
        XCTAssertGreaterThan(s.readyProgress, 0)
        XCTAssertLessThan(s.readyProgress, 1)
    }

    func testRolledPhoneIsNotLevelAndNeverStarts() {
        let rolled = CameraGravity.normalised([sin(5 * Double.pi / 180), cos(5 * Double.pi / 180), 0])!
        let s = feed(engine(.anterior), facingPose(), gravity: rolled, to: 4)
        XCTAssertEqual(s.issues.first, .cameraNotLevel)
        XCTAssertFalse(s.isLevel)
        XCTAssertFalse(s.shouldStartRecording)
    }

    func testPitchedPhoneIsNotLevel() {
        let pitched = CameraGravity.normalised([0, cos(6 * Double.pi / 180), sin(6 * Double.pi / 180)])!
        XCTAssertEqual(feed(engine(.anterior), facingPose(), gravity: pitched, to: 1).issues.first, .cameraNotLevel)
    }

    func testMissingGravityIsNotLevel() {
        XCTAssertEqual(feed(engine(.anterior), facingPose(), gravity: nil, to: 1).issues.first, .cameraNotLevel)
    }

    func testNoPersonDetected() {
        XCTAssertEqual(feed(engine(.anterior), nil, to: 1).issues, [.noPerson])
    }

    func testCroppedFeetAreOutOfFrame() {
        var pose = facingPose()
        pose.joints[.leftAnkle] = .init(x: 0.55, y: 0.995, confidence: 0.9)
        pose.joints[.rightAnkle] = nil
        let s = feed(engine(.anterior), pose, to: 3)
        XCTAssertEqual(s.issues.first, .outOfFrame)
        XCTAssertFalse(s.shouldStartRecording)
    }

    func testLowConfidenceLegsAreOutOfFrame() {
        var pose = facingPose()
        for joint in [J.leftKnee, .rightKnee, .leftAnkle, .rightAnkle] {
            pose.joints[joint] = .init(x: pose.joints[joint]!.x, y: pose.joints[joint]!.y, confidence: 0.1)
        }
        XCTAssertEqual(feed(engine(.anterior), pose, to: 1).issues.first, .outOfFrame)
    }

    func testABarelyDetectedPersonCountsAsNoPerson() {
        XCTAssertEqual(feed(engine(.anterior), facingPose(confidence: 0.1), to: 1).issues, [.noPerson])
    }

    func testBackToTheCameraIsTheWrongViewForAnteriorButRightForPosterior() {
        XCTAssertEqual(feed(engine(.anterior), backPose(), to: 1).issues, [.wrongView])
        XCTAssertEqual(feed(engine(.posterior), backPose(), to: 1).issues, [])
        XCTAssertEqual(feed(engine(.posterior), facingPose(), to: 1).issues, [.wrongView])
    }

    func testLateralViewNeedsANarrowProfileAndTheNamedSideNearer() {
        XCTAssertEqual(feed(engine(.leftLateral), sidePose(near: .left), to: 1).issues, [])
        XCTAssertEqual(feed(engine(.rightLateral), sidePose(near: .left), to: 1).issues, [.wrongView])
        XCTAssertEqual(feed(engine(.rightLateral), sidePose(near: .right), to: 1).issues, [])
        XCTAssertEqual(feed(engine(.leftLateral), facingPose(), to: 1).issues, [.wrongView])
    }

    func testSwayingHipsAreNotStill() {
        let e = engine(.anterior)
        var last: GuidanceStatus?
        for i in 0..<30 {
            let dx = i.isMultiple(of: 2) ? 0.04 : -0.04 // ~8% of body height in pixels
            last = e.update(.init(time: Double(i) * 0.1, pose: facingPose(hipDx: dx), cameraGravity: level))
            XCTAssertFalse(last!.shouldStartRecording)
        }
        XCTAssertEqual(last?.issues, [.moving])
    }

    func testAnIssueRestartsTheReadyTimer() {
        let e = engine(.anterior)
        feed(e, facingPose(), to: 1.6)
        feed(e, nil, from: 1.7, to: 1.7)
        let s = feed(e, facingPose(), from: 1.8, to: 2.4)
        XCTAssertFalse(s.shouldStartRecording)
    }

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

    /// GuidanceIssue's declaration order only - NOT a precedence guarantee
    /// (update(_:)'s check order drives runtime precedence; see the enum's
    /// doc comment). The actual precedence is covered by
    /// testOutOfFrameOutranksTooFarWhenBothApply and
    /// testTooFarOutranksNoPersonWhenLiDARDetectsDistanceWithNoPose below.
    func testTooFarIsDeclaredBetweenOutOfFrameAndNoPerson() {
        XCTAssertEqual(GuidanceIssue.allCases.firstIndex(of: .tooFar), 2)
    }

    func testOutOfFrameOutranksTooFarWhenBothApply() {
        // Small head-to-ankle span triggers isTooFar's frame-fill fallback, and
        // pushing a joint past the edge margin also triggers !isFramed - .outOfFrame
        // must win since framing problems matter more than distance.
        var pose = distantPose(span: 0.2)
        pose.joints[.leftAnkle] = .init(x: 0.001, y: 0.6, confidence: 0.9)
        let s = feed(engine(.anterior), pose, to: 1)
        XCTAssertEqual(s.issues.first, .outOfFrame)
        XCTAssertTrue(s.issues.contains(.tooFar))
        XCTAssertFalse(s.shouldStartRecording)
    }

    func testTooFarOutranksNoPersonWhenLiDARDetectsDistanceWithNoPose() {
        // LiDAR can report distance even when no pose was detected at all; .tooFar
        // must still outrank .noPerson in that case.
        let e = engine(.anterior)
        var status = e.update(.init(time: 0, pose: nil, cameraGravity: level, distanceMeters: 5))
        var t = 0.1
        while t <= 1 + 1e-9 {
            status = e.update(.init(time: t, pose: nil, cameraGravity: level, distanceMeters: 5))
            t += 0.1
        }
        XCTAssertEqual(status.issues.first, .tooFar)
        XCTAssertTrue(status.issues.contains(.noPerson))
    }

    func testPromptsNeverContainANumber() {
        for view in StepView.allCases {
            for issue in GuidanceIssue.allCases {
                let prompt = issue.prompt(for: view)
                XCTAssertFalse(prompt.isEmpty)
                XCTAssertNil(prompt.rangeOfCharacter(from: .decimalDigits), prompt)
            }
        }
    }
}
