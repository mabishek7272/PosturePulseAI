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
