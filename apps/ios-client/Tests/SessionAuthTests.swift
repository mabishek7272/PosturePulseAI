import XCTest
@testable import PostureAnalysisClient

final class SessionAuthTests: XCTestCase {
    func testAuthorizeSetsBearerHeader() {
        var request = URLRequest(url: URL(string: "http://localhost/x")!)
        request.authorize(with: "abc")
        XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer abc")
    }

    func testAuthorizeWithNilLeavesRequestUnchanged() {
        var request = URLRequest(url: URL(string: "http://localhost/x")!)
        request.authorize(with: nil)
        XCTAssertNil(request.value(forHTTPHeaderField: "authorization"))
    }

    func testDecodesCreateSessionResponse() throws {
        let json = #"{"session":{"id":"s1","state":"Setup","subjectPseudoId":"p1"},"sessionToken":"t"}"#
        let response = try JSONDecoder().decode(SessionsClient.CreateSessionResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.session.id, "s1")
        XCTAssertEqual(response.sessionToken, "t")
        XCTAssertEqual(response.credentials, SessionCredentials(sessionId: "s1", token: "t"))
    }
}
