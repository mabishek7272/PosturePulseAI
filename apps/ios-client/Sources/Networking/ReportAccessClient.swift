import Foundation

enum ReleasedReportResult: Equatable {
    case released(AssessmentReportBody)
    /// No clinician has released a report for this session yet.
    case pendingReview
}

/// Patient access to the released report (M1 spec slice B): a long-lived
/// report-access token is requested with the session token right after the
/// battery, kept in the Keychain, and used later to fetch the report once a
/// clinician signs it off.
final class ReportAccessClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    /// POST /sessions/:id/report-access with the subject session token.
    func requestAccess(credentials: SessionCredentials) async throws -> String {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("sessions/\(credentials.sessionId)/report-access"))
        request.httpMethod = "POST"
        request.authorize(with: credentials.token)
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(status) else { throw HTTPStatusError(status: status) }
        struct Result: Decodable { let reportAccessToken: String }
        return try JSONDecoder().decode(Result.self, from: data).reportAccessToken
    }

    /// GET /sessions/:id/released-report with the report-access token.
    func releasedReport(sessionId: String, token: String) async throws -> ReleasedReportResult {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("sessions/\(sessionId)/released-report"))
        request.authorize(with: token)
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        if status == 404 { return .pendingReview }
        guard (200..<300).contains(status) else { throw HTTPStatusError(status: status) }
        // The server may send the report body itself or its stored record { ..., body }.
        struct Stored: Decodable { let body: AssessmentReportBody }
        if let body = try? JSONDecoder().decode(AssessmentReportBody.self, from: data) { return .released(body) }
        return .released(try JSONDecoder().decode(Stored.self, from: data).body)
    }
}

/// Report-access tokens per session, in the Keychain (never in UserDefaults).
final class ReportAccessStore {
    struct Entry: Codable, Equatable {
        let sessionId: String
        let token: String
        let savedAt: Date
    }

    private static let key = "reportAccessTokens"
    private let store: SecretStore

    init(store: SecretStore = KeychainSecretStore()) {
        self.store = store
    }

    /// Newest first.
    func all() -> [Entry] {
        guard let raw = store.read(Self.key), let data = raw.data(using: .utf8) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let entries = (try? decoder.decode([Entry].self, from: data)) ?? []
        return entries.sorted { $0.savedAt > $1.savedAt }
    }

    func save(sessionId: String, token: String, savedAt: Date = Date()) {
        var entries = all().filter { $0.sessionId != sessionId }
        entries.insert(Entry(sessionId: sessionId, token: token, savedAt: savedAt), at: 0)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(Array(entries.prefix(20))), let raw = String(data: data, encoding: .utf8) else { return }
        _ = store.write(Self.key, value: raw)
    }
}
