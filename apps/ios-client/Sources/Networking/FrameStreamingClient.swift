import Foundation

/// Uploads captured frames to backend-api (POST /sessions/:id/frames), which
/// forwards them to ml-service - the AI/inference runs server-side by design
/// (see root README.md, docs/adr). This client only encodes and transports;
/// it never runs pose estimation on-device in this phase.
final class FrameStreamingClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    struct SubmitFrameResult: Decodable {
        // backend-api's current response body only carries decisionEvent +
        // safetyState (see services/backend-api/src/ml-integration/frames.controller.ts);
        // poseLandmarkFrame/qualityGateFlag arrive over the WebSocket channel
        // instead (SessionWebSocketClient). Declared optional here so this
        // struct still decodes correctly if that response is later extended to
        // include them directly.
        let poseLandmarkFrame: PoseLandmarkFrame?
        let qualityGateFlag: QualityGateFlag?
        let decisionEvent: DecisionEvent?
        let safetyState: SafetyState?
    }

    func submitFrame(
        sessionId: String,
        frameId: String,
        capturedAt: Date,
        imageData: Data
    ) async throws -> SubmitFrameResult {
        var request = URLRequest(
            url: BackendConfig.baseURL.appendingPathComponent("sessions/\(sessionId)/frames")
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")

        let body: [String: String] = [
            "frameId": frameId,
            "capturedAt": ISO8601DateFormatter().string(from: capturedAt),
            "imageBase64": imageData.base64EncodedString(),
        ]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw FrameStreamingError.serverError((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        return try JSONDecoder().decode(SubmitFrameResult.self, from: data)
    }
}

enum FrameStreamingError: Error {
    case serverError(Int)
}
