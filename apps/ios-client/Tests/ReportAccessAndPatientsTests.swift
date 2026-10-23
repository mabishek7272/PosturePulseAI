import XCTest
@testable import PostureAnalysisClient

private final class MemorySecretStore: SecretStore {
    var values: [String: String] = [:]
    func read(_ key: String) -> String? { values[key] }
    func write(_ key: String, value: String) -> Bool { values[key] = value; return true }
    func delete(_ key: String) { values[key] = nil }
}

final class ReportAccessClientTests: XCTestCase {
    func testRequestsAReportAccessTokenWithTheSessionToken() async throws {
        let session = StubURLProtocol.session(status: 201, body: Data(#"{"reportAccessToken":"rat-1"}"#.utf8))
        let token = try await ReportAccessClient(session: session).requestAccess(credentials: .init(sessionId: "s1", token: "sub"))
        XCTAssertEqual(token, "rat-1")
        let request = try XCTUnwrap(StubURLProtocol.requests.last)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/sessions/s1/report-access")
        XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer sub")
    }

    func testReleasedReportDecodesTheBody() async throws {
        let session = StubURLProtocol.session(status: 200, body: Data(AssessmentReportMappingTests.releasedBody.utf8))
        let result = try await ReportAccessClient(session: session).releasedReport(sessionId: "s1", token: "rat-1")
        guard case .released(let body) = result else { return XCTFail("expected a released report") }
        XCTAssertEqual(body.reportId, "r1")
        XCTAssertEqual(StubURLProtocol.requests.last?.url?.path, "/sessions/s1/released-report")
        XCTAssertEqual(StubURLProtocol.requests.last?.value(forHTTPHeaderField: "authorization"), "Bearer rat-1")
    }

    func testReleasedReportAlsoAcceptsAStoredRecordWrappingTheBody() async throws {
        let wrapped = #"{"id":"r1","status":"released","body":"# + AssessmentReportMappingTests.releasedBody + "}"
        let result = try await ReportAccessClient(session: StubURLProtocol.session(status: 200, body: Data(wrapped.utf8)))
            .releasedReport(sessionId: "s1", token: "t")
        guard case .released(let body) = result else { return XCTFail("expected a released report") }
        XCTAssertEqual(body.rows.count, 5)
    }

    func testNotFoundMeansPendingReview() async throws {
        let session = StubURLProtocol.session(status: 404, body: Data(#"{"status":"pending_review"}"#.utf8))
        let result = try await ReportAccessClient(session: session).releasedReport(sessionId: "s1", token: "t")
        XCTAssertEqual(result, .pendingReview)
    }

    func testOtherErrorsThrow() async {
        let session = StubURLProtocol.session(status: 401, body: Data())
        do {
            _ = try await ReportAccessClient(session: session).releasedReport(sessionId: "s1", token: "t")
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? HTTPStatusError, HTTPStatusError(status: 401))
        }
    }
}

final class ReportAccessStoreTests: XCTestCase {
    func testKeepsTokensPerSessionNewestFirst() {
        let backing = MemorySecretStore()
        let store = ReportAccessStore(store: backing)
        XCTAssertTrue(store.all().isEmpty)
        store.save(sessionId: "s1", token: "t1", savedAt: Date(timeIntervalSince1970: 100))
        store.save(sessionId: "s2", token: "t2", savedAt: Date(timeIntervalSince1970: 200))
        store.save(sessionId: "s1", token: "t1b", savedAt: Date(timeIntervalSince1970: 300))
        let all = ReportAccessStore(store: backing).all()
        XCTAssertEqual(all.map(\.sessionId), ["s1", "s2"])
        XCTAssertEqual(all.first?.token, "t1b")
    }

    func testCorruptStorageReadsAsEmpty() {
        let backing = MemorySecretStore()
        backing.values["reportAccessTokens"] = "not json"
        XCTAssertTrue(ReportAccessStore(store: backing).all().isEmpty)
    }
}

final class PatientsClientTests: XCTestCase {
    func testSearchSendsTheQueryWithTheClinicianToken() async throws {
        let body = #"[{"id":"p1","name":"Alex Example","dateOfBirth":"1980-02-03"}]"#
        let client = PatientsClient(clinicianToken: "jwt", session: StubURLProtocol.session(status: 200, body: Data(body.utf8)))
        let patients = try await client.search("ale x")
        XCTAssertEqual(patients, [PatientSummary(id: "p1", name: "Alex Example", dateOfBirth: "1980-02-03", contact: nil)])
        let request = try XCTUnwrap(StubURLProtocol.requests.last)
        XCTAssertEqual(request.url?.path, "/patients")
        XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems, [URLQueryItem(name: "q", value: "ale x")])
        XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer jwt")
    }

    func testCreatePostsNameDateOfBirthAndOptionalContact() async throws {
        let client = PatientsClient(clinicianToken: "jwt", session: StubURLProtocol.session(status: 201, body: Data(#"{"id":"p2","name":"B","dateOfBirth":"1990-01-31"}"#.utf8)))
        let patient = try await client.create(name: "B", dateOfBirth: DateComponents(year: 1990, month: 1, day: 31), contact: nil)
        XCTAssertEqual(patient.id, "p2")
        XCTAssertEqual(StubURLProtocol.requests.last?.httpMethod, "POST")
        let sent = try JSONSerialization.jsonObject(with: StubURLProtocol.bodies.last ?? Data()) as? [String: String]
        XCTAssertEqual(sent, ["name": "B", "dateOfBirth": "1990-01-31"])
    }

    func testLinkPostsTheSubjectPseudoId() async throws {
        let client = PatientsClient(clinicianToken: "jwt", session: StubURLProtocol.session(status: 201, body: Data("{}".utf8)))
        try await client.link(patientId: "p1", subjectPseudoId: "sub-123")
        XCTAssertEqual(StubURLProtocol.requests.last?.url?.path, "/patients/p1/link")
        let sent = try JSONSerialization.jsonObject(with: StubURLProtocol.bodies.last ?? Data()) as? [String: String]
        XCTAssertEqual(sent, ["subjectPseudoId": "sub-123"])
    }
}
