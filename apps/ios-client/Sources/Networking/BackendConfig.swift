import Foundation

/// Where the backend-api lives. In this phase there is no service discovery -
/// point this at your dev machine's IP when running on a physical device
/// (localhost only works in the simulator).
struct BackendConfig {
    static let baseURL = URL(string: "http://localhost:3000")!
    static let webSocketURL = URL(string: "ws://localhost:3000")!
}
