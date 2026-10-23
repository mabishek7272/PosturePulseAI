import Foundation

/// POST /auth/login (services/backend-api/src/auth/auth.controller.ts, ADR-010).
final class ClinicianAuthClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    /// Returns the clinician JWT. Throws `.invalidCredentials` on 401.
    func signIn(username: String, password: String) async throws -> String {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("auth/login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(["username": username, "password": password])

        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        if status == 401 { throw ClinicianAuthError.invalidCredentials }
        guard (200..<300).contains(status) else { throw ClinicianAuthError.serverError(status) }
        struct Result: Decodable { let accessToken: String }
        return try JSONDecoder().decode(Result.self, from: data).accessToken
    }
}

enum ClinicianAuthError: Error {
    case invalidCredentials
    case serverError(Int)
}
