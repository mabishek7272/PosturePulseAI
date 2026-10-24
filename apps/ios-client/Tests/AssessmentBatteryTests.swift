import XCTest
@testable import PostureAnalysisClient

final class AssessmentBatteryTests: XCTestCase {
    static var repoRoot: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
    }

    static func realBattery() throws -> AssessmentBattery {
        let data = try Data(contentsOf: repoRoot.appendingPathComponent("references/assessment-battery.v0-draft.json"))
        return try JSONDecoder().decode(AssessmentBattery.self, from: data)
    }

    func testDecodesTheRealBatteryFile() throws {
        let battery = try Self.realBattery()
        XCTAssertEqual(battery.version, "assessment-battery/v0-draft")
        XCTAssertTrue(battery.isDraft)
        XCTAssertEqual(battery.steps.map(\.stepId), ["static.anterior", "static.left_lateral", "static.right_lateral", "static.posterior"])
        let anterior = battery.steps[0]
        XCTAssertEqual(anterior.view, .anterior)
        XCTAssertEqual(anterior.kind, .hold)
        XCTAssertEqual(anterior.durationSeconds, 15)
        XCTAssertEqual(anterior.minFps, 24)
        XCTAssertEqual(anterior.levelToleranceDegrees, 6)
        XCTAssertEqual(anterior.modes, [.clinic, .patient])
        XCTAssertTrue(anterior.metricKeys.contains("static.knee_frontal_alignment"))
        XCTAssertEqual(battery.steps[1].view, .leftLateral)
    }

    func testLevelToleranceDefaultsToSixDegrees() throws {
        let json = """
        {"version":"b/1","status":"approved","steps":[{"stepId":"s","module":"static","title":"T","instruction":"I",
          "view":"posterior","kind":"hold","durationSeconds":5,"minFps":24,"modes":["clinic"],"metricKeys":[]}]}
        """
        let battery = try JSONDecoder().decode(AssessmentBattery.self, from: Data(json.utf8))
        XCTAssertEqual(battery.steps[0].levelToleranceDegrees, 6)
        XCTAssertFalse(battery.isDraft)
    }

    func testStepsAreFilteredByMode() throws {
        let json = """
        {"version":"b/1","status":"draft","steps":[
          {"stepId":"a","module":"static","title":"A","instruction":"I","view":"anterior","kind":"hold","durationSeconds":5,"minFps":24,"modes":["clinic","patient"],"metricKeys":[]},
          {"stepId":"b","module":"functional","title":"B","instruction":"I","view":"anterior","kind":"reps","reps":3,"minFps":30,"modes":["clinic"],"metricKeys":[]}]}
        """
        let battery = try JSONDecoder().decode(AssessmentBattery.self, from: Data(json.utf8))
        XCTAssertEqual(battery.steps(for: .clinic).map(\.stepId), ["a", "b"])
        XCTAssertEqual(battery.steps(for: .patient).map(\.stepId), ["a"])
        XCTAssertEqual(battery.steps[1].reps, 3)
        XCTAssertNil(battery.steps[1].durationSeconds)
    }

    func testOnlyHoldStepsAreRecordableInThisBuild() throws {
        let battery = try Self.realBattery()
        XCTAssertTrue(battery.steps.allSatisfy(\.isRecordableHold))
    }

    func testBatteryClientGetsThePublicEndpoint() async throws {
        let body = try Data(contentsOf: Self.repoRoot.appendingPathComponent("references/assessment-battery.v0-draft.json"))
        let session = StubURLProtocol.session(status: 200, body: body)
        let battery = try await BatteryClient(session: session).fetch()
        XCTAssertEqual(battery.steps.count, 4)
        XCTAssertEqual(StubURLProtocol.requests.last?.url?.path, "/assessment-battery")
        XCTAssertEqual(StubURLProtocol.requests.last?.httpMethod, "GET")
        XCTAssertNil(StubURLProtocol.requests.last?.value(forHTTPHeaderField: "authorization"))
    }
}
