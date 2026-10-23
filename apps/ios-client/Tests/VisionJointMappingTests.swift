import XCTest
@testable import PostureAnalysisClient

final class VisionJointMappingTests: XCTestCase {
    func testFlipsVisionsBottomLeftOriginToTopLeft() {
        let p = VisionJointMapping.point(x: 0.25, y: 0.9, confidence: 0.8)
        XCTAssertEqual(p.x, 0.25, accuracy: 1e-9)
        XCTAssertEqual(p.y, 0.1, accuracy: 1e-9)
        XCTAssertEqual(p.confidence, 0.8, accuracy: 1e-9)
    }

    func testUndetectedJointsAreLeftOut() {
        let pose = VisionJointMapping.pose(from: [
            .nose: (0.5, 0.9, 0.9),
            .leftAnkle: (0.5, 0.1, 0),
        ])
        XCTAssertNotNil(pose.joints[.nose])
        XCTAssertNil(pose.joints[.leftAnkle], "a zero-confidence joint is missing, not guessed")
    }

    func testEveryGuidanceJointHasAVisionName() {
        XCTAssertEqual(Set(VisionJointMapping.visionNames.keys), Set(BodyPose2D.Joint.allCases))
    }
}
