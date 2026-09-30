import Foundation

/// Where the backend-api lives: the shared server behind Caddy/TLS
/// (infra/docker-compose.server.yml). For a local stack use
/// http://localhost:3000 (simulator only; allowed by NSAllowsLocalNetworking).
struct BackendConfig {
    static let baseURL = URL(string: "https://posture.beaive.com")!
    static let webSocketURL = URL(string: "wss://posture.beaive.com")!
}
