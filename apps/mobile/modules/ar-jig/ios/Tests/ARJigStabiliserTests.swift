import XCTest

@testable import ARJigCore

/// The gate must not flicker on tremor or breathing, and must still refuse a
/// camera that is genuinely off-level, out of range, or moving for real.
final class ARJigStabiliserTests: XCTestCase {
    private let t = ARJigThresholds.default
    private let dt: TimeInterval = 1.0 / 60.0

    func testEMAPassesFirstSampleAndDampsAJolt() {
        var s = ARJigStabiliser()
        XCTAssertEqual(s.smooth(pitch: 1, roll: 0, dt: dt).pitch, 1)
        // One 6 deg spike for a single frame barely moves the smoothed pitch.
        let jolt = s.smooth(pitch: 7, roll: 0, dt: dt).pitch
        XCTAssertLessThan(jolt, 1.8)
        // A sustained change is followed: after 1 s it has converged.
        var p = jolt
        for _ in 0..<60 { p = s.smooth(pitch: 5, roll: 0, dt: dt).pitch }
        XCTAssertEqual(p, 5, accuracy: 0.01)
    }

    func testLevelHysteresisHoldsInsideTheMarginButNotBeyondIt() {
        var s = ARJigStabiliser()
        XCTAssertFalse(s.isLevel(pitch: 3.5, roll: 0, t), "not yet level: must enter at the threshold")
        XCTAssertTrue(s.isLevel(pitch: 2.9, roll: 0, t))
        XCTAssertTrue(s.isLevel(pitch: 4.2, roll: 0, t), "inside the 1.5 deg margin once level")
        XCTAssertFalse(s.isLevel(pitch: 4.6, roll: 0, t), "past the margin closes")
        XCTAssertFalse(s.isLevel(pitch: 3.5, roll: 0, t), "and must come back under the threshold to reopen")
    }

    func testExitMarginStaysWellBelowTheServerLimit() {
        let s = ARJigStabiliser()
        XCTAssertLessThan(t.maxPitchDegrees + s.pitchMargin, ARJigThresholds.serverMaxPitchDegrees / 2)
    }

    func testDistanceAndHeightHysteresis() {
        var s = ARJigStabiliser()
        XCTAssertTrue(s.distanceCheck(2.25, t).tooClose)
        XCTAssertFalse(s.distanceCheck(2.4, t).tooClose)
        XCTAssertFalse(s.distanceCheck(2.25, t).tooClose, "within 0.1 m margin once in range")
        XCTAssertTrue(s.distanceCheck(2.15, t).tooClose)
        XCTAssertFalse(s.heightCheck(1.0, t).tooLow)
        XCTAssertFalse(s.heightCheck(0.86, t).tooLow)
        XCTAssertTrue(s.heightCheck(0.84, t).tooLow)
    }

    func testShortBlockerPausesTheHoldInsteadOfResettingIt() {
        var s = ARJigStabiliser()
        var acc: TimeInterval = 0
        var open = false
        for _ in 0..<60 { (acc, open) = s.advanceHold(accumulated: acc, blocked: false, wasOpen: open, dt: dt, hold: 1.5) }
        XCTAssertEqual(acc, 1.0, accuracy: 1e-9)
        // A 0.1 s blip (6 frames) keeps the progress.
        for _ in 0..<6 { (acc, open) = s.advanceHold(accumulated: acc, blocked: true, wasOpen: open, dt: dt, hold: 1.5) }
        XCTAssertEqual(acc, 1.0, accuracy: 1e-9)
        for _ in 0..<31 { (acc, open) = s.advanceHold(accumulated: acc, blocked: false, wasOpen: open, dt: dt, hold: 1.5) }
        XCTAssertTrue(open)
        // A blip while open keeps it open.
        (acc, open) = s.advanceHold(accumulated: acc, blocked: true, wasOpen: open, dt: dt, hold: 1.5)
        XCTAssertTrue(open)
    }

    func testLongBlockerStillResetsAndCloses() {
        var s = ARJigStabiliser()
        var acc: TimeInterval = 1.5
        var open = true
        for _ in 0..<30 { (acc, open) = s.advanceHold(accumulated: acc, blocked: true, wasOpen: open, dt: dt, hold: 1.5) }
        XCTAssertEqual(acc, 0)
        XCTAssertFalse(open)
    }

    func testResetForgetsHistoryButKeepsTuning() {
        var s = ARJigStabiliser()
        s.grace = 0.5
        _ = s.smooth(pitch: 2, roll: 1, dt: dt)
        s.reset()
        XCTAssertNil(s.smoothedPitch)
        XCTAssertEqual(s.grace, 0.5)
    }
}
