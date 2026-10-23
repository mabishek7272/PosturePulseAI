import Foundation

/// A patient-register entry (ADR-017). Identifiers live only in the
/// clinician-only server register; the app shows them in Clinic mode and
/// never stores, logs or sends them anywhere else.
struct PatientSummary: Decodable, Equatable, Identifiable {
    let id: String
    let name: String?
    let dateOfBirth: String?
    let contact: String?
}

/// Clinic mode patient register: /patients with the clinician JWT (ADR-010).
final class PatientsClient {
    private let clinicianToken: String
    private let session: URLSession

    init(clinicianToken: String, session: URLSession = .shared) {
        self.clinicianToken = clinicianToken
        self.session = session
    }

    func search(_ query: String) async throws -> [PatientSummary] {
        var components = URLComponents(url: BackendConfig.baseURL.appendingPathComponent("patients"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        var request = URLRequest(url: components.url!)
        request.authorize(with: clinicianToken)
        return try await send(request, as: [PatientSummary].self)
    }

    func create(name: String, dateOfBirth: DateComponents, contact: String?) async throws -> PatientSummary {
        var body = ["name": name, "dateOfBirth": Self.isoDate(dateOfBirth)]
        if let contact, !contact.isEmpty { body["contact"] = contact }
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("patients"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.authorize(with: clinicianToken)
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request, as: PatientSummary.self)
    }

    /// Links the visit's pseudonymous subject to the register entry.
    func link(patientId: String, subjectPseudoId: String) async throws {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("patients/\(patientId)/link"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.authorize(with: clinicianToken)
        request.httpBody = try JSONEncoder().encode(["subjectPseudoId": subjectPseudoId])
        let (_, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(status) else { throw HTTPStatusError(status: status) }
    }

    private func send<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(status) else { throw HTTPStatusError(status: status) }
        return try JSONDecoder().decode(T.self, from: data)
    }

    static func isoDate(_ c: DateComponents) -> String {
        String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}
