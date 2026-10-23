import XCTest
@testable import PostureAnalysisClient

/// Device gravity (CoreMotion: x = right edge in portrait, y = top edge,
/// z = out of the screen) -> camera frame C of the oriented back-camera image
/// (x = image right, y = image down, z = optical axis away from the camera).
final class GravityConversionTests: XCTestCase {
    private func assertVector(_ v: [Double], _ expected: [Double], accuracy: Double = 1e-9, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(v.count, 3, file: file, line: line)
        for (a, b) in zip(v, expected) { XCTAssertEqual(a, b, accuracy: accuracy, file: file, line: line) }
    }

    func testPortraitUprightLevelPhoneGivesImageDown() {
        // Phone upright in portrait: gravity pulls toward the bottom edge (-y device).
        assertVector(CameraGravity.cameraFrame(deviceGravity: [0, -1, 0], orientation: .portrait), [0, 1, 0])
    }

    func testPortraitMapsAxesAsGxMinusGyMinusGz() {
        let g = [0.1, -0.9, 0.2]
        let n = (0.01 + 0.81 + 0.04).squareRoot()
        assertVector(CameraGravity.cameraFrame(deviceGravity: g, orientation: .portrait), [0.1 / n, 0.9 / n, -0.2 / n])
    }

    func testPortraitScreenTippedUpMakesTheCameraLookDown() {
        // Screen tipped to face slightly upward: gravity gains a component into
        // the screen (-z device), so the back camera looks slightly down and
        // gravity has a component along the optical axis (+z in C).
        let c = CameraGravity.cameraFrame(deviceGravity: [0, -0.99, -0.141], orientation: .portrait)
        XCTAssertGreaterThan(c[2], 0)
        XCTAssertEqual(c.map { $0 * $0 }.reduce(0, +), 1, accuracy: 1e-9)
    }

    func testPortraitRollShowsUpAsImageX() {
        // Rolled so the right edge dips: gravity gains +x device -> +x image.
        let c = CameraGravity.cameraFrame(deviceGravity: [0.0872, -0.9962, 0], orientation: .portrait)
        XCTAssertEqual(CameraGravity.rollDegrees(c), 5, accuracy: 0.05)
    }

    func testLandscapeRightUprightGivesImageDown() {
        // Home button / USB-C on the right: the device's top edge points left and
        // its right edge points up, so gravity is along -x device.
        assertVector(CameraGravity.cameraFrame(deviceGravity: [-1, 0, 0], orientation: .landscapeRight), [0, 1, 0])
        assertVector(CameraGravity.cameraFrame(deviceGravity: [0, 1, 0], orientation: .landscapeRight), [-1, 0, 0])
    }

    func testLandscapeLeftUprightGivesImageDown() {
        assertVector(CameraGravity.cameraFrame(deviceGravity: [1, 0, 0], orientation: .landscapeLeft), [0, 1, 0])
        assertVector(CameraGravity.cameraFrame(deviceGravity: [0, 1, 0], orientation: .landscapeLeft), [1, 0, 0])
    }

    func testPortraitUpsideDownUprightGivesImageDown() {
        assertVector(CameraGravity.cameraFrame(deviceGravity: [0, 1, 0], orientation: .portraitUpsideDown), [0, 1, 0])
    }

    func testOpticalAxisIsMinusDeviceZInEveryOrientation() {
        for orientation in ClipOrientation.allCases {
            let c = CameraGravity.cameraFrame(deviceGravity: [0, 0, -1], orientation: orientation)
            assertVector(c, [0, 0, 1])
        }
    }

    func testOutputIsUnitNormalised() {
        let c = CameraGravity.cameraFrame(deviceGravity: [0.2, -0.5, 0.1], orientation: .landscapeLeft)
        XCTAssertEqual(c.map { $0 * $0 }.reduce(0, +), 1, accuracy: 1e-9)
    }

    func testPitchAndRollOfLevelPhoneAreZero() {
        XCTAssertEqual(CameraGravity.rollDegrees([0, 1, 0]), 0, accuracy: 1e-9)
        XCTAssertEqual(CameraGravity.pitchDegrees([0, 1, 0]), 0, accuracy: 1e-9)
        XCTAssertEqual(CameraGravity.pitchDegrees([0, 0.9962, 0.0872]), 5, accuracy: 0.05)
    }

    func testZeroGravityIsRejected() {
        XCTAssertNil(CameraGravity.normalised([0, 0, 0]))
    }
}
