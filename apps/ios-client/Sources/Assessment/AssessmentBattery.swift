import Foundation

/// Which side of the body faces the camera (assessment-battery / clip-capture
/// `view`). left_lateral = the person's left side faces the camera.
enum StepView: String, Codable, CaseIterable {
    case anterior
    case posterior
    case leftLateral = "left_lateral"
    case rightLateral = "right_lateral"
}

// Mirrors packages/schemas/src/assessment-battery.schema.json (version v0).
// Hand-kept, not codegenned - see docs/adr/004-ios-dtos-hand-kept.md.
/// The ordered capture steps of an assessment, served by GET /assessment-battery.
struct AssessmentBattery: Decodable, Equatable {
    let version: String
    let status: String
    let steps: [Step]

    var isDraft: Bool { status != "approved" }

    func steps(for mode: SessionMode) -> [Step] {
        steps.filter { $0.modes.contains(mode) }
    }

    struct Step: Decodable, Equatable, Identifiable {
        enum Kind: String, Decodable { case hold, reps, passes }

        let stepId: String
        let module: String
        let title: String
        /// Shown and spoken to the person being assessed.
        let instruction: String
        let view: StepView
        let kind: Kind
        let durationSeconds: Double?
        let reps: Int?
        let minFps: Double
        let levelToleranceDegrees: Double
        let modes: [SessionMode]
        let metricKeys: [String]

        var id: String { stepId }

        /// M1 records timed holds only; reps/passes steps arrive with M2.
        var isRecordableHold: Bool { kind == .hold && (durationSeconds ?? 0) > 0 }

        private enum CodingKeys: String, CodingKey {
            case stepId, module, title, instruction, view, kind, durationSeconds, reps, minFps, levelToleranceDegrees, modes, metricKeys
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            stepId = try c.decode(String.self, forKey: .stepId)
            module = try c.decode(String.self, forKey: .module)
            title = try c.decode(String.self, forKey: .title)
            instruction = try c.decode(String.self, forKey: .instruction)
            view = try c.decode(StepView.self, forKey: .view)
            kind = try c.decode(Kind.self, forKey: .kind)
            durationSeconds = try c.decodeIfPresent(Double.self, forKey: .durationSeconds)
            reps = try c.decodeIfPresent(Int.self, forKey: .reps)
            minFps = try c.decode(Double.self, forKey: .minFps)
            levelToleranceDegrees = try c.decodeIfPresent(Double.self, forKey: .levelToleranceDegrees) ?? 6
            // Unknown modes from a newer battery are ignored rather than failing the whole battery.
            modes = try c.decode([String].self, forKey: .modes).compactMap(SessionMode.init(rawValue:))
            metricKeys = try c.decode([String].self, forKey: .metricKeys)
        }

        #if DEBUG
        init(stepId: String, title: String, instruction: String, view: StepView, durationSeconds: Double,
             minFps: Double = 24, levelToleranceDegrees: Double = 6, modes: [SessionMode] = [.clinic, .patient],
             metricKeys: [String] = []) {
            self.stepId = stepId
            self.module = "static"
            self.title = title
            self.instruction = instruction
            self.view = view
            self.kind = .hold
            self.durationSeconds = durationSeconds
            self.reps = nil
            self.minFps = minFps
            self.levelToleranceDegrees = levelToleranceDegrees
            self.modes = modes
            self.metricKeys = metricKeys
        }
        #endif
    }
}

extension SessionMode: Decodable {}
