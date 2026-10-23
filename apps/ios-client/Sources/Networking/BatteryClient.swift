import Foundation

/// GET /assessment-battery (public): the ordered capture steps, as data.
final class BatteryClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func fetch() async throws -> AssessmentBattery {
        let (data, response) = try await session.data(from: BackendConfig.baseURL.appendingPathComponent("assessment-battery"))
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(status) else { throw HTTPStatusError(status: status) }
        return try JSONDecoder().decode(AssessmentBattery.self, from: data)
    }
}

/// A non-2xx answer from backend-api.
struct HTTPStatusError: Error, Equatable {
    let status: Int
}
