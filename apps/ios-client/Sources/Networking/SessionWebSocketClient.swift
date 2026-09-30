import Foundation

/// Receives state/quality/decision pushes from backend-api's SessionGateway
/// (services/backend-api/src/ws/session.gateway.ts). Connects with a
/// `sessionId` query param, matching the gateway's room-join logic.
///
/// This is a minimal placeholder using raw URLSessionWebSocketTask against a
/// plain `ws://` endpoint - the actual backend gateway is Socket.IO
/// (@nestjs/platform-socket.io), which speaks its own handshake/framing on top
/// of plain WebSocket. A real implementation needs a Socket.IO-compatible
/// Swift client library rather than this raw approach; this class documents
/// the intended message shapes and connection lifecycle so that swap-in is
/// mechanical. Do not ship this as-is against the real gateway without that
/// library.
final class SessionWebSocketClient {
    private var task: URLSessionWebSocketTask?
    private let sessionId: String
    private let decoder = JSONDecoder()

    var onStateChange: ((SafetyState) -> Void)?
    var onQualityGateFlag: ((QualityGateFlag) -> Void)?
    var onDecisionEvent: ((DecisionEvent) -> Void)?
    var onPoseLandmarkFrame: ((PoseLandmarkFrame) -> Void)?

    init(sessionId: String) {
        self.sessionId = sessionId
    }

    func connect() {
        var components = URLComponents(url: BackendConfig.webSocketURL, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "sessionId", value: sessionId)]
        task = URLSession.shared.webSocketTask(with: components.url!)
        task?.resume()
        listen()
    }

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func listen() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                // Connection dropped - callers must treat this as "quality
                // unknown", never assume the last-known state still holds.
                return
            case .success(let message):
                if case .string(let text) = message {
                    self.handleIncoming(text)
                }
                self.listen()
            }
        }
    }

    /// Expected envelope shape: {"event": "<name>", "payload": {...}} - adjust
    /// to match whatever the eventual Socket.IO client library surfaces.
    private func handleIncoming(_ text: String) {
        guard
            let data = text.data(using: .utf8),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let event = json["event"] as? String,
            let payloadObject = json["payload"],
            let payloadData = try? JSONSerialization.data(withJSONObject: payloadObject)
        else { return }

        switch event {
        case "state":
            struct StatePayload: Decodable { let state: SafetyState }
            if let p = try? decoder.decode(StatePayload.self, from: payloadData) {
                onStateChange?(p.state)
            }
        case "quality-gate-flag":
            if let flag = try? decoder.decode(QualityGateFlag.self, from: payloadData) {
                onQualityGateFlag?(flag)
            }
        case "decision-event":
            if let decisionEvent = try? decoder.decode(DecisionEvent.self, from: payloadData) {
                onDecisionEvent?(decisionEvent)
            }
        case "pose-landmark-frame":
            if let frame = try? decoder.decode(PoseLandmarkFrame.self, from: payloadData) {
                onPoseLandmarkFrame?(frame)
            }
        default:
            break
        }
    }
}
