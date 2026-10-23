import Foundation

/// The readout model behind AssessmentReportView, mapped from the
/// assessment-report body (ADR-015). Rows describe measurements only; nothing
/// here grades, scores or interprets them.
struct AssessmentReport: Identifiable {
    enum Status { case draft, released, rejected }

    enum Tier: CaseIterable {
        case estimate, proxy, entered, annotated, notMeasurable

        init(_ raw: String) {
            switch raw {
            case "proxy": self = .proxy
            case "entered": self = .entered
            case "annotated": self = .annotated
            case "not_measurable": self = .notMeasurable
            default: self = .estimate
            }
        }

        var label: String {
            switch self {
            case .estimate: return "Estimate"
            case .proxy: return "Proxy"
            case .entered: return "Entered"
            case .annotated: return "Annotated"
            case .notMeasurable: return "Not measurable"
            }
        }
    }

    /// Where the estimate +/- uncertainty sits against the reference.
    enum Position: CaseIterable {
        case below, within, above, indeterminate, noReference, notApplicable

        init(_ raw: String) {
            switch raw {
            case "below": self = .below
            case "within": self = .within
            case "above": self = .above
            case "indeterminate": self = .indeterminate
            case "no_reference": self = .noReference
            default: self = .notApplicable
            }
        }

        var label: String {
            switch self {
            case .below: return "Below the reference"
            case .within: return "Within the reference"
            case .above: return "Above the reference"
            case .indeterminate: return "Overlaps the reference"
            case .noReference: return "No reference set"
            case .notApplicable: return "Not measured"
            }
        }
    }

    let id: String
    let status: Status
    let signedAt: Date?
    let producedAt: Date
    let referenceFileIsDraft: Bool
    let sections: [Section]
    let notMeasurable: [NotMeasurableItem]
    let clinicianAssessment: String?
    /// Rows the reviewing clinician excluded; they stay in the record but are not shown.
    let excludedCount: Int

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
        let tier: Tier
        let estimate: Estimate?
        /// Plain-words quality reasons when no value could be supported.
        let unsupportedReasons: [String]
        let reference: Reference?
        let position: Position
        let analysis: Analysis?
        /// Per-rep values for movement rows (drawn as a rep strip).
        let reps: [Double]?
    }

    struct Estimate {
        let value: Double
        let uncertainty: Double
    }

    struct Reference {
        let label: String
        let source: String
        let isDraft: Bool
        /// nil when the reference has no numeric bounds the app can draw.
        let bounds: ClosedRange<Double>?

        init(label: String, source: String, isDraft: Bool, bounds: ClosedRange<Double>?) {
            self.label = label
            self.source = source
            self.isDraft = isDraft
            self.bounds = bounds
        }

        init(body: AssessmentReportBody.Reference) {
            var bounds: ClosedRange<Double>?
            if let lo = body.min, let hi = body.max, lo <= hi {
                bounds = lo...hi
            } else if let v = body.value {
                bounds = v...v
            } else {
                bounds = Self.parse(body.label)
            }
            self.init(
                label: bounds.map(Self.label(for:)) ?? body.label,
                source: body.sourceCitation,
                isDraft: body.status != "approved",
                bounds: bounds
            )
        }

        /// Reads "0 deg", "0-5 deg", "-2 to 3 %" style labels.
        static func parse(_ label: String) -> ClosedRange<Double>? {
            let pattern = #"^\s*(-?\d+(?:\.\d+)?)\s*(?:(?:-|–|to)\s*(-?\d+(?:\.\d+)?))?\s*[A-Za-z%°_ ]*$"#
            guard let regex = try? NSRegularExpression(pattern: pattern),
                  let match = regex.firstMatch(in: label, range: NSRange(label.startIndex..., in: label)),
                  let r1 = Range(match.range(at: 1), in: label), let lo = Double(label[r1]) else { return nil }
            if let r2 = Range(match.range(at: 2), in: label), let hi = Double(label[r2]) {
                return lo <= hi ? lo...hi : nil
            }
            return lo...lo
        }

        static func label(for bounds: ClosedRange<Double>) -> String {
            bounds.lowerBound == bounds.upperBound
                ? AssessmentReport.format(bounds.lowerBound)
                : "\(AssessmentReport.format(bounds.lowerBound))–\(AssessmentReport.format(bounds.upperBound))"
        }
    }

    struct Analysis {
        let text: String

        /// Every row's sentence is a fixed template filled with the row's own numbers.
        var sourceLabel: String { "Fixed wording" }
    }

    struct NotMeasurableItem: Identifiable {
        let id: String
        let label: String
        let reason: String
        let whatWouldBeNeeded: String
    }

    static func format(_ value: Double) -> String {
        value.rounded() == value ? String(Int(value)) : String(format: "%.1f", value)
    }

    static func displayUnit(_ unit: String) -> String {
        switch unit {
        case "deg": return "°"
        case "percent_stature", "percent": return "%"
        case "cm": return " cm"
        case "s": return " s"
        case "per_min": return "/min"
        case "count", "none": return ""
        default: return " " + unit
        }
    }

    /// Fallback titles for the M1 static steps when no battery is at hand.
    static let knownStepTitles: [String: String] = [
        "static.anterior": "Front view",
        "static.posterior": "Back view",
        "static.left_lateral": "Left side",
        "static.right_lateral": "Right side",
    ]

    static let moduleTitles: [String: String] = [
        "static": "Standing posture",
        "functional": "Movement",
        "gait": "Walking",
        "workstation": "Workstation",
        "ergonomic": "Workstation",
    ]

    /// Fixed copy the report screen shows around the rows.
    static let introCopy = "Camera-based estimates of visible body angles and positions. Your clinician interprets these results with you."
    static let notMeasuredCopy = "“Not measured” means the recording was not good enough to estimate that value; nothing is guessed."
    static let draftReferenceCopy = "Reference values come from a draft reference file that a clinical lead has not yet signed off."
    static let proxyCopy = "Proxy: a simple 2D measurement that stands in for a clinical one. It is compared only with a geometric reference, such as a level line."
    static let percentCopy = "% values are a percentage of body height as seen by the camera (nose to heel)."
    static let notMeasurableCopy = "These cannot be measured with a phone camera. They are listed so nothing is left implied."
    static var fixedCopy: [String] { [introCopy, notMeasuredCopy, draftReferenceCopy, proxyCopy, percentCopy, notMeasurableCopy] }
}

extension AssessmentReport {
    init(body: AssessmentReportBody, stepTitles: [String: String] = [:]) {
        let visible = body.rows.filter { $0.excluded == nil }

        var order: [String] = []
        var grouped: [String: [Row]] = [:]
        for row in visible {
            let key = row.stepId ?? row.module
            if grouped[key] == nil { order.append(key) }
            grouped[key, default: []].append(Self.row(from: row))
        }
        let sections = order.map { key in
            Section(
                id: key,
                title: stepTitles[key] ?? Self.knownStepTitles[key] ?? Self.moduleTitles[key] ?? key,
                subtitle: Self.moduleTitles[visible.first { ($0.stepId ?? $0.module) == key }?.module ?? ""] ?? "",
                rows: grouped[key] ?? []
            )
        }

        let status: Status
        switch body.status {
        case "released": status = .released
        case "rejected": status = .rejected
        default: status = .draft
        }

        self.init(
            id: body.reportId,
            status: status,
            signedAt: body.signOff.flatMap { ISO8601.date(from: $0.signedAt) },
            producedAt: ISO8601.date(from: body.provenance.producedAt) ?? Date.distantPast,
            referenceFileIsDraft: body.rows.contains { $0.reference.map { $0.status != "approved" } ?? false },
            sections: sections,
            notMeasurable: body.notMeasurable.map {
                NotMeasurableItem(id: $0.metricKey, label: $0.label, reason: $0.reason, whatWouldBeNeeded: $0.whatWouldBeNeeded)
            },
            clinicianAssessment: body.clinicianAssessment?.text,
            excludedCount: body.rows.count - visible.count
        )
    }

    private static func row(from row: AssessmentReportBody.Row) -> Row {
        var metric = row.label
        if let side = row.side, side == "left" || side == "right", !metric.lowercased().contains(side) {
            metric += " · " + side.capitalized
        }
        let position = Position(row.position)
        return Row(
            id: "\(row.stepId ?? row.module)|\(row.metricKey)|\(row.side ?? "")",
            metric: metric,
            unit: displayUnit(row.unit),
            tier: Tier(row.tier),
            estimate: row.estimate.map { Estimate(value: $0.value, uncertainty: $0.uncertainty) },
            unsupportedReasons: (row.unsupportedReasons ?? []).map(QualityReasonText.plain),
            // A row positioned "no reference" never draws a reference band.
            reference: position == .noReference ? nil : row.reference.map(Reference.init(body:)),
            position: position,
            analysis: Analysis(text: row.analysis.text),
            reps: nil
        )
    }
}

#if DEBUG
extension AssessmentReport {
    var withoutFirstSection: AssessmentReport {
        AssessmentReport(id: id, status: status, signedAt: signedAt, producedAt: producedAt,
                         referenceFileIsDraft: referenceFileIsDraft, sections: Array(sections.dropFirst()),
                         notMeasurable: notMeasurable, clinicianAssessment: clinicianAssessment, excludedCount: excludedCount)
    }

    /// Illustrative values for design previews only - not a real session.
    /// Sentences follow the backend's fixed templates (value, uncertainty, reference only).
    static let sample = AssessmentReport(
        id: "sample",
        status: .released,
        signedAt: Date(timeIntervalSince1970: 1_790_003_600),
        producedAt: Date(timeIntervalSince1970: 1_790_000_000),
        referenceFileIsDraft: true,
        sections: [
            Section(id: "static.anterior", title: "Front view", subtitle: "Standing posture", rows: [
                Row(id: "head", metric: "Head lateral tilt", unit: "°", tier: .estimate,
                    estimate: Estimate(value: 1.5, uncertainty: 0.9), unsupportedReasons: [],
                    reference: Reference(label: "0", source: "Level line (definition)", isDraft: true, bounds: 0...0),
                    position: .above,
                    analysis: Analysis(text: "1.5° ± 0.9°; above the 0° reference by about 0.6°."), reps: nil),
                Row(id: "shoulder", metric: "Shoulder line tilt", unit: "°", tier: .proxy,
                    estimate: Estimate(value: 0.8, uncertainty: 1.2), unsupportedReasons: [],
                    reference: Reference(label: "0", source: "Level line (definition)", isDraft: true, bounds: 0...0),
                    position: .indeterminate,
                    analysis: Analysis(text: "0.8° ± 1.2°; the uncertainty overlaps the 0° reference."), reps: nil),
                Row(id: "knee-l", metric: "Knee frontal alignment · Left", unit: "°", tier: .proxy,
                    estimate: Estimate(value: 2.2, uncertainty: 1.4), unsupportedReasons: [],
                    reference: nil, position: .noReference,
                    analysis: Analysis(text: "2.2° ± 1.4°. No reference value is set for this measurement."), reps: nil),
                Row(id: "shift", metric: "Lateral body shift", unit: "%", tier: .estimate,
                    estimate: nil, unsupportedReasons: ["Part of the body was outside the frame"],
                    reference: nil, position: .notApplicable,
                    analysis: Analysis(text: "Not measured: part of the body was outside the frame."), reps: nil),
            ]),
            Section(id: "static.left_lateral", title: "Left side", subtitle: "Standing posture", rows: [
                Row(id: "trunk", metric: "Trunk inclination", unit: "°", tier: .estimate,
                    estimate: Estimate(value: 2.1, uncertainty: 0.7), unsupportedReasons: [],
                    reference: Reference(label: "0–5", source: "Draft reference v0", isDraft: true, bounds: 0...5),
                    position: .within,
                    analysis: Analysis(text: "2.1° ± 0.7°; within the 0–5° reference."), reps: nil),
            ]),
        ],
        notMeasurable: [
            NotMeasurableItem(id: "cva", label: "Craniovertebral angle", reason: "Needs a marker on the C7 vertebra.",
                              whatWouldBeNeeded: "A C7 skin marker and a calibrated side photo."),
            NotMeasurableItem(id: "emg", label: "Muscle activity", reason: "A camera cannot see muscle activity.",
                              whatWouldBeNeeded: "Surface EMG sensors."),
        ],
        clinicianAssessment: "Sample text written by the reviewing clinician.",
        excludedCount: 0
    )
}
#endif
