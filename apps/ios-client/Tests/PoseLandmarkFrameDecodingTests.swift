import XCTest
@testable import PostureAnalysisClient

/// Decodes fixtures shaped exactly like ml-service's real emitter output
/// (see services/ml-service/tests/test_schema_contract.py) to catch DTO drift
/// early. NOT run in this repo's automated CI in this phase - no Swift
/// toolchain is available in the sandbox this was authored in (see
/// apps/ios-client/README.md). Run via Xcode/xcodebuild once the project is
/// opened on macOS.
final class PoseLandmarkFrameDecodingTests: XCTestCase {
    func testDecodesOccludedLandmark() throws {
        let json = """
        {
          "frameId": "f1", "sessionId": "s1", "personTrackId": "s1:person-0",
          "capturedAt": "2026-01-01T00:00:00Z", "frame": "B",
          "landmarks": [
            {"jointName": "leftKnee", "position": null, "confidence": 0.0, "observationState": "occluded"}
          ]
        }
        """.data(using: .utf8)!

        let frame = try JSONDecoder().decode(PoseLandmarkFrame.self, from: json)
        XCTAssertEqual(frame.landmarks.first?.observationState, .occluded)
        XCTAssertNil(frame.landmarks.first?.position)
    }

    func testDecodesUnsupportedQualityGateFlag() throws {
        let json = """
        {
          "flagId": "f1", "sessionId": "s1", "frameId": "fr1",
          "evaluatedAt": "2026-01-01T00:00:00Z", "state": "unsupported",
          "reasons": ["occlusion"], "affectedOutputs": ["pose-landmark-frame"]
        }
        """.data(using: .utf8)!

        let flag = try JSONDecoder().decode(QualityGateFlag.self, from: json)
        XCTAssertFalse(flag.isSupported)
        XCTAssertEqual(flag.reasons, ["occlusion"])
    }
}
