import Foundation

/// POST /auth/patient/signup and /auth/patient/login
/// (services/backend-api/src/auth/patient-auth.controller.ts, ADR-019).
final class PatientAuthClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    /// Returns the patient JWT. Throws `.emailTaken` on 409, `.invalidInput` on 400.
    func signUp(email: String, password: String) async throws -> String {
        try await post(path: "auth/patient/signup", email: email, password: password)
    }

    /// Returns the patient JWT. Throws `.invalidCredentials` on 401.
    func signIn(email: String, password: String) async throws -> String {
        try await post(path: "auth/patient/login", email: email, password: password)
    }

    private func post(path: String, email: String, password: String) async throws -> String {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(["email": email, "password": password])

        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        if status == 401 { throw PatientAuthError.invalidCredentials }
        if status == 409 { throw PatientAuthError.emailTaken }
        if status == 400 { throw PatientAuthError.invalidInput }
        guard (200..<300).contains(status) else { throw PatientAuthError.serverError(status) }
        struct Result: Decodable { let accessToken: String }
        return try JSONDecoder().decode(Result.self, from: data).accessToken
    }
}

enum PatientAuthError: Error, Equatable {
    case invalidCredentials
    case emailTaken
    case invalidInput
    case serverError(Int)
}
