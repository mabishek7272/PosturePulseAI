import Foundation

// Mirrors session.schema.json `state` enum (packages/schemas/src/session.schema.json,
// version v0) and services/backend-api/src/safety/safety-state-machine.ts.
// Hand-kept, not codegenned - see docs/adr/004-ios-dtos-hand-kept.md. If you
// change the safety states on the backend, update this enum in the same PR.
enum SafetyState: String, Codable {
    case setup = "Setup"
    case observing = "Observing"
    case cueEligible = "CueEligible"
    case pause = "Pause"
    case unavailable = "Unavailable"
    case clinicianReview = "ClinicianReview"
}
