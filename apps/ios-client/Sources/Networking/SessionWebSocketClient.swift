import Foundation
import SocketIO

/// Receives state/quality/decision pushes from backend-api's Socket.IO
/// SessionGateway (services/backend-api/src/ws/session.gateway.ts). Joins the
/// session's room with `?sessionId=` and authenticates with the session token;
/// the gateway disconnects any other client (docs/adr/012).
final class SessionWebSocketClient {
    private let manager: SocketManager
    private let socket: SocketIOClient
    private let token: String
    private let decoder = JSONDecoder()

    var onStateChange: ((SafetyState) -> Void)?
    var onQualityGateFlag: ((QualityGateFlag) -> Void)?
    var onDecisionEvent: ((DecisionEvent) -> Void)?
    var onPoseLandmarkFrame: ((PoseLandmarkFrame) -> Void)?

    init(credentials: SessionCredentials) {
        token = credentials.token
        manager = SocketManager(
            socketURL: BackendConfig.baseURL,
            config: [.log(false), .forceWebsockets(true), .connectParams(["sessionId": credentials.sessionId])]
        )
        socket = manager.defaultSocket
    }

    func connect() {
        socket.on("state") { [weak self] data, _ in
            struct StatePayload: Decodable { let state: SafetyState }
            if let payload: StatePayload = self?.decode(data) { self?.onStateChange?(payload.state) }
        }
        socket.on("quality-gate-flag") { [weak self] data, _ in
            if let flag: QualityGateFlag = self?.decode(data) { self?.onQualityGateFlag?(flag) }
        }
        socket.on("decision-event") { [weak self] data, _ in
            if let event: DecisionEvent = self?.decode(data) { self?.onDecisionEvent?(event) }
        }
        socket.on("pose-landmark-frame") { [weak self] data, _ in
            if let frame: PoseLandmarkFrame = self?.decode(data) { self?.onPoseLandmarkFrame?(frame) }
        }
        socket.connect(withPayload: ["token": token])
    }

    func disconnect() {
        socket.disconnect()
    }

    /// Socket.IO hands each event's payload over as a JSON-compatible object in data[0].
    private func decode<T: Decodable>(_ data: [Any]) -> T? {
        guard
            let object = data.first,
            JSONSerialization.isValidJSONObject(object),
            let json = try? JSONSerialization.data(withJSONObject: object)
        else { return nil }
        return try? decoder.decode(T.self, from: json)
    }
}
