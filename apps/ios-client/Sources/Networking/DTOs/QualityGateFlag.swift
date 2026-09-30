import Foundation

// Mirrors packages/schemas/src/quality-gate-flag.schema.json (version v0).
// Hand-kept, not codegenned - see docs/adr/004-ios-dtos-hand-kept.md.
struct QualityGateFlag: Codable {
    let flagId: String
    let sessionId: String
    let frameId: String
    let evaluatedAt: String
    let state: State
    let reasons: [String]
    let affectedOutputs: [String]

    enum State: String, Codable {
        case supported
        case unsupported
    }

    var isSupported: Bool { state == .supported }
}
