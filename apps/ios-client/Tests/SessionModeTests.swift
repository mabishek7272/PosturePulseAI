import XCTest
@testable import PostureAnalysisClient

private final class StubProtocol: URLProtocol {
    static var status = 200
    static var body = Data()
    static var lastRequest: URLRequest?
    static var lastBody: Data?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lastRequest = request
        Self.lastBody = request.httpBody ?? request.httpBodyStream.map { stream in
            stream.open(); defer { stream.close() }
            var data = Data(); var buf = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable { let n = stream.read(&buf, maxLength: buf.count); if n <= 0 { break }; data.append(buf, count: n) }
            return data
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class SessionModeTests: XCTestCase {
    private func client() -> ClinicianAuthClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        return ClinicianAuthClient(session: URLSession(configuration: config))
    }

    func testModesHaveDistinctCopyAndOnlyClinicNeedsSignIn() {
        XCTAssertEqual(SessionMode.allCases, [.clinic, .patient])
        XCTAssertTrue(SessionMode.clinic.requiresClinicianSignIn)
        XCTAssertFalse(SessionMode.patient.requiresClinicianSignIn)
        XCTAssertNotEqual(SessionMode.clinic.title, SessionMode.patient.title)
    }

    func testSignInPostsCredentialsAndReturnsToken() async throws {
        StubProtocol.status = 201
        StubProtocol.body = Data(#"{"accessToken":"jwt-123"}"#.utf8)
        let token = try await client().signIn(username: "drchen", password: "pw")
        XCTAssertEqual(token, "jwt-123")
        XCTAssertEqual(StubProtocol.lastRequest?.url?.path, "/auth/login")
        XCTAssertEqual(StubProtocol.lastRequest?.httpMethod, "POST")
        let sent = try JSONSerialization.jsonObject(with: StubProtocol.lastBody ?? Data()) as? [String: String]
        XCTAssertEqual(sent, ["username": "drchen", "password": "pw"])
    }

    func testSignInRejectsBadCredentials() async {
        StubProtocol.status = 401
        StubProtocol.body = Data(#"{"message":"Invalid username or password"}"#.utf8)
        do {
            _ = try await client().signIn(username: "x", password: "y")
            XCTFail("expected invalidCredentials")
        } catch ClinicianAuthError.invalidCredentials {
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }
}
