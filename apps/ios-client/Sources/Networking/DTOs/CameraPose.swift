import Foundation

// Mirrors packages/schemas/src/camera-pose.schema.json (version v0).
// Hand-kept, not codegenned - see docs/adr/004-ios-dtos-hand-kept.md.
struct CameraPose: Codable {
    let timestamp: String
    let translation: [Double] // [x, y, z]
    let rotation: [Double] // [x, y, z, w]
    let anchorConfidence: Double
    let trackingState: TrackingState
    let worldAnchorId: String

    enum TrackingState: String, Codable {
        case normal
        case limited
        case notAvailable
    }
}
