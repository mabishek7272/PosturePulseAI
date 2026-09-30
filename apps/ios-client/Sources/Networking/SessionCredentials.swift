import Foundation

/// The session a device is working in and the session-scoped token
/// POST /sessions returned for it (docs/adr/012).
struct SessionCredentials: Equatable {
    let sessionId: String
    let token: String
}

extension URLRequest {
    mutating func authorize(with token: String?) {
        guard let token else { return }
        setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
    }
}
