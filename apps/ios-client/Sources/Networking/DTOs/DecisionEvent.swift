import Foundation

// Mirrors packages/schemas/src/decision-event.schema.json (version v0).
// Hand-kept, not codegenned - see docs/adr/004-ios-dtos-hand-kept.md.
struct DecisionEvent: Codable {
    let decisionEventId: String
    let sessionId: String
    let evaluatedAt: String
    let action: Action
    let cuePayload: CuePayload?
    let expiry: String

    enum Action: String, Codable {
        case cue
        case stop
        case pause
        case measurementUnavailable = "measurement_unavailable"
        case noAction = "no_action"
        case escalateReview = "escalate_review"
    }

    struct CuePayload: Codable {
        let cueId: String
        let text: String
        let modality: [String]?
    }

    /// The client must check this before rendering `cuePayload` - an event whose
    /// expiry has passed must never be displayed or acted on (TRD 2.2).
    var isExpired: Bool {
        guard let expiryDate = ISO8601DateFormatter().date(from: expiry) else { return true }
        return Date() > expiryDate
    }
}
