import XCTest
@testable import PostureAnalysisClient

final class ClipSidecarTests: XCTestCase {
    private static var repoRoot: URL {
        // Tests/ClipSidecarTests.swift -> apps/ios-client -> apps -> repo root
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
    }

    private func schema(_ name: String) throws -> [String: Any] {
        let url = Self.repoRoot.appendingPathComponent("packages/schemas/src/\(name).schema.json")
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    private func sampleSidecar() -> ClipCapture {
        var builder = SidecarBuilder(orientation: .portrait)
        builder.append(presentationTime: 100.0, deviceGravity: [0, -1, 0])
        builder.append(presentationTime: 100.0 + 1.0 / 30, deviceGravity: [0.0872, -0.9962, 0])
        builder.append(presentationTime: 100.0 + 2.0 / 30, deviceGravity: [0, -1, 0])
        return ClipCapture(
            clipId: "c1",
            sessionId: "s1",
            stepId: "static.anterior",
            view: .anterior,
            recordedAt: Date(timeIntervalSince1970: 1_790_000_000),
            nominalFps: 30,
            width: 1080,
            height: 1920,
            frames: builder.frames,
            intrinsics: nil,
            device: .init(model: "iPhone18,1", lens: .backWide, appVersion: "0.1.0 (2)"),
            provenance: .clipRecorder(producedAt: Date(timeIntervalSince1970: 1_790_000_001))
        )
    }

    func testBuilderTimesFramesFromTheFirstFrameAndConvertsGravity() {
        let frames = sampleSidecar().frames
        XCTAssertEqual(frames.map(\.index), [0, 1, 2])
        XCTAssertEqual(frames[0].t, 0, accuracy: 1e-9)
        XCTAssertEqual(frames[1].t, 1.0 / 30, accuracy: 1e-9)
        XCTAssertEqual(frames[2].t, 2.0 / 30, accuracy: 1e-9)
        XCTAssertEqual(frames[0].gravity[1], 1, accuracy: 1e-9)
        XCTAssertGreaterThan(frames[1].gravity[0], 0.08)
    }

    func testEncodedSidecarUsesTheSchemaFieldNames() throws {
        let data = try ClipCapture.encoder.encode(sampleSidecar())
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let schema = try schema("clip-capture")

        let properties = try XCTUnwrap(schema["properties"] as? [String: Any])
        let required = try XCTUnwrap(schema["required"] as? [String])
        XCTAssertEqual(Set(json.keys), Set(properties.keys), "every schema property is sent (intrinsics as null)")
        XCTAssertTrue(Set(required).isSubset(of: Set(json.keys)))

        let frameSchema = try XCTUnwrap(((properties["frames"] as? [String: Any])?["items"]) as? [String: Any])
        let frame = try XCTUnwrap((json["frames"] as? [[String: Any]])?.first)
        XCTAssertEqual(Set(frame.keys), Set(try XCTUnwrap(frameSchema["properties"] as? [String: Any]).keys))
        XCTAssertEqual((frame["gravity"] as? [Double])?.count, 3)

        let deviceSchema = try XCTUnwrap(properties["device"] as? [String: Any])
        let device = try XCTUnwrap(json["device"] as? [String: Any])
        XCTAssertEqual(Set(device.keys), Set(try XCTUnwrap(deviceSchema["required"] as? [String])))
        let lenses = try XCTUnwrap(((deviceSchema["properties"] as? [String: Any])?["lens"] as? [String: Any])?["enum"] as? [String])
        XCTAssertTrue(lenses.contains(try XCTUnwrap(device["lens"] as? String)))

        let views = try XCTUnwrap((properties["view"] as? [String: Any])?["enum"] as? [String])
        XCTAssertTrue(views.contains(try XCTUnwrap(json["view"] as? String)))
        XCTAssertTrue(json["intrinsics"] is NSNull)
    }

    func testProvenanceHasTheCommonRequiredFields() throws {
        let data = try ClipCapture.encoder.encode(sampleSidecar())
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let provenance = try XCTUnwrap(json["provenance"] as? [String: Any])
        let common = try schema("common")
        let defs = try XCTUnwrap(common["$defs"] as? [String: Any])
        let required = try XCTUnwrap((defs["provenance"] as? [String: Any])?["required"] as? [String])
        XCTAssertTrue(Set(required).isSubset(of: Set(provenance.keys)))
        XCTAssertEqual(provenance["schemaVersion"] as? String, "clip-capture/v0")
    }

    func testTimestampsAreISO8601() throws {
        let data = try ClipCapture.encoder.encode(sampleSidecar())
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let recordedAt = try XCTUnwrap(json["recordedAt"] as? String)
        XCTAssertNotNil(ISO8601.date(from: recordedAt), recordedAt)
        XCTAssertTrue(recordedAt.hasSuffix("Z"))
    }
}
