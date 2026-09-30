import Foundation

/// Creates and calibrates sessions against backend-api.
final class SessionsClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    struct CreateSessionInput: Encodable {
        let subjectPseudoId: String
        let protocolId: String
        let protocolVersion: String
        let deploymentContext: String // "clinic_supervised" | "home_rehab"
        let consentRecordId: String
        let retentionPolicy: RetentionPolicy

        struct RetentionPolicy: Encodable {
            let rawVideo: RawVideo
            let derivedEvents: DerivedEvents
            struct RawVideo: Encodable { let optIn: Bool; let retentionDays: Int? }
            struct DerivedEvents: Encodable { let retentionDays: Int }
        }
    }

    struct SessionRecord: Decodable {
        let id: String
        let state: SafetyState
    }

    struct CreateSessionResponse: Decodable {
        let session: SessionRecord
        let sessionToken: String
        var credentials: SessionCredentials { SessionCredentials(sessionId: session.id, token: sessionToken) }
    }

    /// Throws `.consentRejected` on 403 - the stored consent record is missing,
    /// revoked, or lacks a required scope, so the caller must ask again.
    func create(_ input: CreateSessionInput) async throws -> CreateSessionResponse {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("sessions"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(input)

        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        if status == 403 { throw SessionsClientError.consentRejected }
        guard (200..<300).contains(status) else { throw SessionsClientError.serverError(status) }
        return try JSONDecoder().decode(CreateSessionResponse.self, from: data)
    }

    /// Setup -> Observing, once the calibration flow confirms the camera view
    /// and consent are in place (services/backend-api/src/sessions/sessions.controller.ts).
    func calibrate(credentials: SessionCredentials) async throws -> SafetyState {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("sessions/\(credentials.sessionId)/calibrate"))
        request.httpMethod = "POST"
        request.authorize(with: credentials.token)
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(status) else { throw SessionsClientError.serverError(status) }
        struct Result: Decodable { let state: SafetyState }
        return try JSONDecoder().decode(Result.self, from: data).state
    }

    /// Feeds subject-specific scale calibration (docs/adr/008) - call before submitScaleCalibrationFrame.
    func setHeight(credentials: SessionCredentials, subjectHeightMeters: Double) async throws {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("sessions/\(credentials.sessionId)/height"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.authorize(with: credentials.token)
        request.httpBody = try JSONEncoder().encode(["subjectHeightMeters": subjectHeightMeters])
        let (_, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(status) else { throw SessionsClientError.serverError(status) }
    }

    /// Runs subject-specific scale calibration against a single frame. Throws
    /// on 422 (ankle/nose not fully observed) - the caller should ask the
    /// user to reposition and retry, never treat this as success.
    func submitScaleCalibrationFrame(credentials: SessionCredentials, frameId: String, imageData: Data) async throws {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("sessions/\(credentials.sessionId)/scale-calibration"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.authorize(with: credentials.token)
        request.httpBody = try JSONEncoder().encode([
            "frameId": frameId,
            "imageBase64": imageData.base64EncodedString(),
        ])
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ScaleCalibrationError.notObserved((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
    }
}

enum ScaleCalibrationError: Error {
    case notObserved(Int)
}

enum SessionsClientError: Error {
    case consentRejected
    case serverError(Int)
}
