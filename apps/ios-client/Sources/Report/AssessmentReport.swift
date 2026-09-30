import Foundation

/// Client-side shape of the assessment report record
/// (docs/superpowers/specs/2026-10-01-posture-report-design.md §7.1).
struct AssessmentReport: Identifiable {
    enum Status { case draft, released }

    let id: String
    let status: Status
    let releasedBy: String?
    let producedAt: Date
    let referenceFileIsDraft: Bool
    let sections: [Section]

    struct Section: Identifiable {
        let id: String
        let title: String
        let subtitle: String
        let rows: [Row]
    }

    struct Row: Identifiable {
        let id: String
        let metric: String
        let unit: String
        let estimate: Estimate?
        /// Set instead of `estimate` when the quality gate could not support a value.
        let unsupportedReason: String?
        let reference: Reference?
        let analysis: Analysis?
        /// Per-rep values for movement rows (drawn as a rep strip).
        let reps: [Double]?
    }

    struct Estimate {
        let value: Double
        let uncertainty: Double
    }

    struct Reference {
        enum Kind {
            case value(Double)
            case range(Double, Double)
        }
        let kind: Kind
        let source: String

        var label: String {
            switch kind {
            case .value(let v): return AssessmentReport.format(v)
            case .range(let lo, let hi): return "\(AssessmentReport.format(lo))–\(AssessmentReport.format(hi))"
            }
        }

        var bounds: ClosedRange<Double> {
            switch kind {
            case .value(let v): return v...v
            case .range(let lo, let hi): return lo...hi
            }
        }
    }

    struct Analysis {
        enum Source { case medbuddyLLM, medbuddyTemplate, beaiveTemplate }
        let text: String
        let source: Source

        var sourceLabel: String {
            switch source {
            case .medbuddyLLM: return "MedBuddy · checked"
            case .medbuddyTemplate, .beaiveTemplate: return "Fixed wording"
            }
        }
    }

    static func format(_ value: Double) -> String {
        value.rounded() == value ? String(Int(value)) : String(format: "%.1f", value)
    }
}

#if DEBUG
extension AssessmentReport {
    var withoutFirstSection: AssessmentReport {
        AssessmentReport(id: id, status: status, releasedBy: releasedBy, producedAt: producedAt,
                         referenceFileIsDraft: referenceFileIsDraft, sections: Array(sections.dropFirst()))
    }

    /// Illustrative values for design previews only - not a real session.
    static let sample = AssessmentReport(
        id: "sample",
        status: .released,
        releasedBy: "Dr. A. Rao",
        producedAt: Date(timeIntervalSince1970: 1_790_000_000),
        referenceFileIsDraft: true,
        sections: [
            Section(id: "posture", title: "Posture", subtitle: "Standing scan · front and side", rows: [
                Row(id: "head", metric: "Head–shoulder angle", unit: "°",
                    estimate: Estimate(value: 80.7, uncertainty: 4), unsupportedReason: nil,
                    reference: Reference(kind: .value(90), source: "Draft reference v0"),
                    analysis: Analysis(text: "Mild anterior carriage (~9.3° from the 90° reference).", source: .medbuddyLLM),
                    reps: nil),
                Row(id: "shoulder", metric: "Shoulder level", unit: "°",
                    estimate: Estimate(value: 2.6, uncertainty: 1.5), unsupportedReason: nil,
                    reference: Reference(kind: .value(0), source: "Draft reference v0"),
                    analysis: Analysis(text: "Right shoulder lower by ~2.6°.", source: .medbuddyLLM),
                    reps: nil),
                Row(id: "pelvis", metric: "Pelvic level (lateral)", unit: "°",
                    estimate: Estimate(value: 3.0, uncertainty: 2), unsupportedReason: nil,
                    reference: Reference(kind: .value(0), source: "Draft reference v0"),
                    analysis: Analysis(text: "Minor lateral deviation (~3.0°).", source: .beaiveTemplate),
                    reps: nil),
                Row(id: "knee-l", metric: "Knee frontal-plane angle · L", unit: "°",
                    estimate: Estimate(value: 1.9, uncertainty: 3), unsupportedReason: nil,
                    reference: Reference(kind: .range(0, 5), source: "Draft reference v0"),
                    analysis: Analysis(text: "Within the 0–5° reference range.", source: .medbuddyLLM),
                    reps: nil),
                Row(id: "knee-r", metric: "Knee frontal-plane angle · R", unit: "°",
                    estimate: Estimate(value: 2.2, uncertainty: 3), unsupportedReason: nil,
                    reference: Reference(kind: .range(0, 5), source: "Draft reference v0"),
                    analysis: Analysis(text: "Within the 0–5° reference range; within 0.3° of the left.", source: .medbuddyLLM),
                    reps: nil),
                Row(id: "trunk", metric: "Trunk lateral lean", unit: "°",
                    estimate: nil, unsupportedReason: "Hips not fully visible in the front view.",
                    reference: Reference(kind: .value(0), source: "Draft reference v0"),
                    analysis: nil, reps: nil),
            ]),
            Section(id: "squat", title: "Bodyweight squat", subtitle: "5 reps · side view", rows: [
                Row(id: "depth", metric: "Peak knee flexion", unit: "°",
                    estimate: Estimate(value: 95, uncertainty: 5), unsupportedReason: nil,
                    reference: Reference(kind: .range(90, 120), source: "Draft reference v0"),
                    analysis: Analysis(text: "Reps 1–5 ranged 92–98°; rep 5 was the shallowest.", source: .medbuddyLLM),
                    reps: [98, 97, 96, 95, 92]),
                Row(id: "sym", metric: "Left–right difference", unit: "°",
                    estimate: Estimate(value: 3.1, uncertainty: 2), unsupportedReason: nil,
                    reference: Reference(kind: .range(0, 5), source: "Draft reference v0"),
                    analysis: Analysis(text: "Within the 0–5° reference range across all reps.", source: .beaiveTemplate),
                    reps: nil),
            ]),
            Section(id: "thermal", title: "Thermal", subtitle: "Requires a thermal sensor", rows: [
                Row(id: "trap", metric: "Trapezius ΔT", unit: "°C",
                    estimate: nil, unsupportedReason: "No thermal sensor connected.",
                    reference: nil, analysis: nil, reps: nil),
            ]),
        ]
    )
}
#endif
