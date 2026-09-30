import Foundation

// Mirrors packages/schemas/src/pose-landmark-frame.schema.json (version v0).
// Hand-kept, not codegenned - see docs/adr/004-ios-dtos-hand-kept.md.
struct PoseLandmarkFrame: Codable {
    let frameId: String
    let sessionId: String
    let personTrackId: String
    let capturedAt: String
    let frame: String
    let landmarks: [Landmark]

    struct Landmark: Codable {
        let jointName: String
        // null when observationState is "occluded" - never treat a missing/nil
        // position as a fabricated value; render nothing for that joint.
        let position: [Double]?
        let confidence: Double
        let observationState: ObservationState
    }

    enum ObservationState: String, Codable {
        case observed
        case imputed
        case occluded
    }
}
