import Foundation

/// POSTs a symptom report to backend-api. Always call the caller's local-stop
/// action BEFORE awaiting this - see SymptomStopButton. This client retries
/// once on failure so a flaky network doesn't silently drop a safety-relevant
/// report, but the local stop must never wait on that retry.
final class SymptomReportingClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    struct SymptomReportInput {
        let sessionId: String
        let symptoms: [String]
        let severity: String // "mild" | "moderate" | "severe"
        let freeText: String?
    }

    @discardableResult
    func report(_ input: SymptomReportInput, retryOnce: Bool = true) async throws -> SafetyState {
        do {
            return try await send(input)
        } catch where retryOnce {
            return try await send(input)
        }
    }

    private func send(_ input: SymptomReportInput) async throws -> SafetyState {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("symptom-reports"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(
            SymptomReportBody(
                sessionId: input.sessionId,
                symptoms: input.symptoms,
                severity: input.severity,
                freeText: input.freeText
            )
        )

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw SymptomReportingError.serverError((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        struct Result: Decodable { let state: SafetyState }
        return try JSONDecoder().decode(Result.self, from: data).state
    }
}

private struct SymptomReportBody: Encodable {
    let sessionId: String
    let symptoms: [String]
    let severity: String
    let freeText: String?
}

enum SymptomReportingError: Error {
    case serverError(Int)
}
