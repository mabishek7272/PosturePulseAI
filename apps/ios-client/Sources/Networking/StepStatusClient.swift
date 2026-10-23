import Foundation

/// One battery step's server-side analysis state (GET /sessions/:id/steps).
struct StepStatus: Decodable, Equatable {
    enum State: String, Decodable {
        case missing, processing, analyzed, failed, unknown

        init(from decoder: Decoder) throws {
            self = State(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
        }
    }

    let stepId: String
    let status: State
    /// nil until the step is analysed.
    let usable: Bool?
    /// quality-gate-flag reasons, e.g. "out_of_frame".
    let reasons: [String]
    /// The clip the status describes, when the server says so.
    let clipId: String?

    private enum CodingKeys: String, CodingKey { case stepId, status, usable, reasons, clipId }

    init(stepId: String, status: State, usable: Bool?, reasons: [String], clipId: String? = nil) {
        self.stepId = stepId
        self.status = status
        self.usable = usable
        self.reasons = reasons
        self.clipId = clipId
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        stepId = try c.decode(String.self, forKey: .stepId)
        status = try c.decode(State.self, forKey: .status)
        usable = try c.decodeIfPresent(Bool.self, forKey: .usable)
        reasons = try c.decodeIfPresent([String].self, forKey: .reasons) ?? []
        clipId = try c.decodeIfPresent(String.self, forKey: .clipId)
    }
}

protocol StepStatusFetching: AnyObject {
    func fetch(credentials: SessionCredentials) async throws -> [StepStatus]
}

/// GET /sessions/:id/steps with the subject's session token.
final class StepStatusClient: StepStatusFetching {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func fetch(credentials: SessionCredentials) async throws -> [StepStatus] {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("sessions/\(credentials.sessionId)/steps"))
        request.authorize(with: credentials.token)
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(status) else { throw HTTPStatusError(status: status) }
        struct Wrapped: Decodable { let steps: [StepStatus] }
        if let list = try? JSONDecoder().decode([StepStatus].self, from: data) { return list }
        return try JSONDecoder().decode(Wrapped.self, from: data).steps
    }
}
