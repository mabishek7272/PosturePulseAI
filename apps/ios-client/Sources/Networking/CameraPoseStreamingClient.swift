import Foundation

/// Periodic POST of T_WC(t) samples to backend-api
/// (services/backend-api/src/sessions/sessions.controller.ts `POST /:id/camera-poses`).
/// Not verified in this sandbox - see apps/ios-client/README.md.
final class CameraPoseStreamingClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func submit(sessionId: String, pose: CameraPose) async throws {
        var request = URLRequest(
            url: BackendConfig.baseURL.appendingPathComponent("sessions/\(sessionId)/camera-poses")
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(pose)

        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw CameraPoseStreamingError.serverError((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
    }
}

enum CameraPoseStreamingError: Error {
    case serverError(Int)
}
