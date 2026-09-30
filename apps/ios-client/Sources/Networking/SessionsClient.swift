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

    func create(_ input: CreateSessionInput) async throws -> SessionRecord {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("sessions"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(input)

        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode(SessionRecord.self, from: data)
    }

    /// Setup -> Observing, once the calibration flow confirms the camera view
    /// and consent are in place (services/backend-api/src/sessions/sessions.controller.ts).
    func calibrate(sessionId: String) async throws -> SafetyState {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("sessions/\(sessionId)/calibrate"))
        request.httpMethod = "POST"
        let (data, _) = try await session.data(for: request)
        struct Result: Decodable { let state: SafetyState }
        return try JSONDecoder().decode(Result.self, from: data).state
    }

    /// Feeds subject-specific scale calibration (docs/adr/008) - call before submitScaleCalibrationFrame.
    func setHeight(sessionId: String, subjectHeightMeters: Double) async throws {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("sessions/\(sessionId)/height"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(["subjectHeightMeters": subjectHeightMeters])
        _ = try await session.data(for: request)
    }

    /// Runs subject-specific scale calibration against a single frame. Throws
    /// on 422 (ankle/nose not fully observed) - the caller should ask the
    /// user to reposition and retry, never treat this as success.
    func submitScaleCalibrationFrame(sessionId: String, frameId: String, imageData: Data) async throws {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("sessions/\(sessionId)/scale-calibration"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
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
