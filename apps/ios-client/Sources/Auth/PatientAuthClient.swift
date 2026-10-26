import Foundation

/// POST /auth/patient/signup and /auth/patient/login
/// (services/backend-api/src/auth/patient-auth.controller.ts, ADR-019).
final class PatientAuthClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    /// Returns the patient JWT. Expected failure: `.emailTaken` (409) or
    /// `.invalidInput` (400) - but see `post(path:email:password:)`, every
    /// case can in principle surface from either endpoint.
    func signUp(email: String, password: String) async throws -> String {
        try await post(path: "auth/patient/signup", email: email, password: password)
    }

    /// Returns the patient JWT. Expected failure: `.invalidCredentials`
    /// (401) - but see `post(path:email:password:)`, every case can in
    /// principle surface from either endpoint.
    func signIn(email: String, password: String) async throws -> String {
        try await post(path: "auth/patient/login", email: email, password: password)
    }

    /// Shared by both endpoints, so every `PatientAuthError` case can in
    /// principle come from either `signUp` or `signIn`, not just the case
    /// each one's own doc comment calls out as the expected failure.
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
