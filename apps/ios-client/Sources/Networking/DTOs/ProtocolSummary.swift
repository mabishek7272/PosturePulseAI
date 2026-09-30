import Foundation

// Mirrors the subset of packages/schemas/src/protocol-definition.schema.json
// (version v0) the client needs for protocol selection. Hand-kept, not
// codegenned - see docs/adr/004-ios-dtos-hand-kept.md.
struct ProtocolSummary: Codable, Identifiable {
    let protocolKey: String
    let version: String
    let definition: Definition

    var id: String { "\(protocolKey)@\(version)" }

    struct Definition: Codable {
        let name: String
        let status: String
        let clinicallyValidated: Bool
        let targetPopulation: String
    }

    /// The UI must show DraftBadge whenever this is true - never present a draft
    /// protocol as clinically reviewed (docs/claims-and-scope.md).
    var isDraft: Bool { definition.status == "draft" }
}
