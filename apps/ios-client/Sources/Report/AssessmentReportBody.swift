import Foundation

// Mirrors packages/schemas/src/assessment-report.schema.json (version v0).
// Hand-kept, not codegenned - see docs/adr/004-ios-dtos-hand-kept.md.
/// The report record as backend-api serves it (ADR-015). Rows describe
/// measurements only; `clinicianAssessment` is the one place a named
/// clinician's own interpretation appears.
struct AssessmentReportBody: Decodable, Equatable {
    let reportId: String
    let sessionId: String
    let reportVersion: Int
    let supersedesReportId: String?
    let status: String
    let rows: [Row]
    let notMeasurable: [NotMeasurable]
    let clinicianAssessment: ClinicianAssessment?
    let signOff: SignOff?
    let provenance: ProvenanceBody

    struct Row: Decodable, Equatable {
        let metricKey: String
        let resultId: String?
        let label: String
        let module: String
        let tier: String
        let unit: String
        let side: String?
        /// Not in the v0 schema's row; read when the server includes it so rows
        /// can be grouped by battery step.
        let stepId: String?
        let estimate: Estimate?
        let unsupportedReasons: [String]?
        let reference: Reference?
        let position: String
        let analysis: Analysis
        let excluded: Excluded?
    }

    struct Estimate: Decodable, Equatable {
        let value: Double
        let uncertainty: Double
    }

    struct Reference: Decodable, Equatable {
        let kind: String
        let label: String
        let sourceCitation: String
        let status: String
        /// Not in the v0 schema's row reference; used for the gauge when present.
        let value: Double?
        let min: Double?
        let max: Double?
    }

    struct Analysis: Decodable, Equatable {
        let text: String
        let source: String
        let templateId: String?
    }

    struct Excluded: Decodable, Equatable {
        let reason: String
        let clinicianId: String
    }

    struct NotMeasurable: Decodable, Equatable {
        let metricKey: String
        let label: String
        let reason: String
        let whatWouldBeNeeded: String
    }

    struct ClinicianAssessment: Decodable, Equatable {
        let text: String
        let clinicianId: String
    }

    struct SignOff: Decodable, Equatable {
        let clinicianId: String
        let signedAt: String
        let contentSha256: String
    }

    struct ProvenanceBody: Decodable, Equatable {
        let schemaVersion: String
        let modelVersion: String
        let calibrationVersion: String
        let producedAt: String
        let metricsVersion: String?
        let referenceFileVersion: String?
    }
}

/// quality-gate-flag reasons in plain words, for "Not measured" rows and the
/// Redo prompt after a step.
enum QualityReasonText {
    static let known: [String: String] = [
        "insufficient_landmarks": "Not enough body points were found",
        "insufficient_scale": "No usable scale was available",
        "identity_uncertain": "The same person could not be followed throughout",
        "anchor_drift": "The camera position drifted",
        "low_confidence": "Body points were found with low confidence",
        "occlusion": "Part of the body was hidden",
        "wrong_view": "The body was not facing the way this step asks",
        "out_of_frame": "Part of the body was outside the frame",
        "camera_not_level": "The phone was not level",
        "insufficient_frame_rate": "The video frame rate was too low",
        "insufficient_frames": "Too few usable video frames",
        "subject_moving": "There was too much movement during the hold",
    ]

    static func plain(_ reason: String) -> String {
        if let text = known[reason] { return text }
        let words = reason.replacingOccurrences(of: "_", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }
}
