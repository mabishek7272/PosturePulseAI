import XCTest
@testable import PostureAnalysisClient

final class PatientAuthClientTests: XCTestCase {
    func testSignInDecodesAccessTokenOn200() async throws {
        let session = StubURLProtocol.session(status: 200, body: Data(#"{"accessToken":"jwt-abc"}"#.utf8))
        let client = PatientAuthClient(session: session)

        let token = try await client.signIn(email: "a@example.com", password: "pw")

        XCTAssertEqual(token, "jwt-abc")
        let request = try XCTUnwrap(StubURLProtocol.requests.last)
        XCTAssertEqual(request.url?.path, "/auth/patient/login")
        XCTAssertEqual(request.httpMethod, "POST")
    }

    func testSignUpDecodesAccessTokenOn200() async throws {
        let session = StubURLProtocol.session(status: 200, body: Data(#"{"accessToken":"jwt-xyz"}"#.utf8))
        let client = PatientAuthClient(session: session)

        let token = try await client.signUp(email: "a@example.com", password: "pw")

        XCTAssertEqual(token, "jwt-xyz")
        let request = try XCTUnwrap(StubURLProtocol.requests.last)
        XCTAssertEqual(request.url?.path, "/auth/patient/signup")
    }

    func test401ThrowsInvalidCredentials() async throws {
        let session = StubURLProtocol.session(status: 401, body: Data())
        let client = PatientAuthClient(session: session)
        do {
            _ = try await client.signIn(email: "a@example.com", password: "pw")
            XCTFail("expected an error")
        } catch let error as PatientAuthError {
            XCTAssertEqual(error, .invalidCredentials)
        }
    }

    func test409ThrowsEmailTaken() async throws {
        let session = StubURLProtocol.session(status: 409, body: Data())
        let client = PatientAuthClient(session: session)
        do {
            _ = try await client.signUp(email: "a@example.com", password: "pw")
            XCTFail("expected an error")
        } catch let error as PatientAuthError {
            XCTAssertEqual(error, .emailTaken)
        }
    }

    func test400ThrowsInvalidInput() async throws {
        let session = StubURLProtocol.session(status: 400, body: Data())
        let client = PatientAuthClient(session: session)
        do {
            _ = try await client.signUp(email: "a@example.com", password: "pw")
            XCTFail("expected an error")
        } catch let error as PatientAuthError {
            XCTAssertEqual(error, .invalidInput)
        }
    }
}
