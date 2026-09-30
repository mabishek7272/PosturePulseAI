import Foundation

/// Fetches draft exercise protocols from backend-api (GET /protocols).
final class ProtocolsClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func list() async throws -> [ProtocolSummary] {
        let (data, _) = try await session.data(from: BackendConfig.baseURL.appendingPathComponent("protocols"))
        return try JSONDecoder().decode([ProtocolSummary].self, from: data)
    }
}
