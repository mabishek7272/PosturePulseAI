import Foundation

/// POST /consent-records (services/backend-api/src/consent/consent.controller.ts).
final class ConsentClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    struct CreateConsentInput: Encodable {
        let subjectPseudoId: String
        let scopes: [String]
    }

    struct ConsentRecord: Decodable {
        let id: String
    }

    func create(_ input: CreateConsentInput) async throws -> ConsentRecord {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("consent-records"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(input)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ConsentClientError.serverError((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        return try JSONDecoder().decode(ConsentRecord.self, from: data)
    }
}

enum ConsentClientError: Error {
    case serverError(Int)
}
