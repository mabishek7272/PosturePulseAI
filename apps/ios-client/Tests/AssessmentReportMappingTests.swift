import XCTest
@testable import PostureAnalysisClient

/// assessment-report body (ADR-015) -> the iOS readout model.
final class AssessmentReportMappingTests: XCTestCase {
    static let releasedBody = #"""
    {
      "reportId": "r1", "sessionId": "s1", "reportVersion": 2, "supersedesReportId": "r0", "status": "released",
      "rows": [
        {"metricKey": "static.shoulder_line_tilt", "resultId": "m1", "label": "Shoulder line tilt", "module": "static",
         "tier": "proxy", "unit": "deg", "side": null, "stepId": "static.anterior",
         "estimate": {"value": 1.2, "uncertainty": 0.8},
         "reference": {"kind": "geometric", "label": "0 deg", "sourceCitation": "Level line (definition)", "status": "draft"},
         "position": "indeterminate",
         "analysis": {"text": "1.2° ± 0.8°; the uncertainty overlaps the 0° reference.", "source": "fixed_template", "templateId": "indeterminate.proxy"},
         "excluded": null},
        {"metricKey": "static.knee_frontal_alignment", "resultId": "m2", "label": "Knee frontal alignment", "module": "static",
         "tier": "proxy", "unit": "deg", "side": "left", "stepId": "static.anterior",
         "estimate": {"value": 3.4, "uncertainty": 1.1}, "reference": null, "position": "no_reference",
         "analysis": {"text": "3.4° ± 1.1°. No reference value is set for this measurement.", "source": "fixed_template"},
         "excluded": null},
        {"metricKey": "static.lateral_body_shift", "resultId": "m3", "label": "Lateral body shift", "module": "static",
         "tier": "estimate", "unit": "percent_stature", "side": null, "stepId": "static.anterior",
         "estimate": null, "unsupportedReasons": ["out_of_frame", "subject_moving"], "reference": null,
         "position": "not_applicable",
         "analysis": {"text": "Not measured: part of the body was outside the frame.", "source": "fixed_template"},
         "excluded": null},
        {"metricKey": "static.trunk_inclination", "resultId": "m4", "label": "Trunk inclination", "module": "static",
         "tier": "estimate", "unit": "deg", "side": null, "stepId": "static.left_lateral",
         "estimate": {"value": 7.0, "uncertainty": 1.0},
         "reference": {"kind": "literature", "label": "0-5 deg", "sourceCitation": "Draft citation", "status": "draft"},
         "position": "above",
         "analysis": {"text": "7° ± 1°; above the 0–5° reference by about 1°.", "source": "fixed_template"},
         "excluded": null},
        {"metricKey": "static.plumb_offset_ear", "resultId": "m5", "label": "Plumb offset, ear", "module": "static",
         "tier": "estimate", "unit": "percent_stature", "side": null, "stepId": "static.left_lateral",
         "estimate": {"value": 2.0, "uncertainty": 0.5},
         "reference": {"kind": "literature", "label": "about zero", "min": -1, "max": 3, "sourceCitation": "Draft citation", "status": "draft"},
         "position": "within",
         "analysis": {"text": "2% ± 0.5%; within the reference.", "source": "fixed_template"},
         "excluded": {"reason": "Clothing covered the ear", "clinicianId": "c1"}}
      ],
      "notMeasurable": [
        {"metricKey": "nm.craniovertebral_angle", "label": "Craniovertebral angle", "reason": "Needs a marker on C7", "whatWouldBeNeeded": "A C7 skin marker and a lateral photo"}
      ],
      "clinicianAssessment": {"text": "Reviewed with the patient.", "clinicianId": "c1"},
      "signOff": {"clinicianId": "c1", "signedAt": "2026-10-20T10:00:00.000Z", "contentSha256": "\#(String(repeating: "a", count: 64))"},
      "provenance": {"schemaVersion": "assessment-report/v0", "modelVersion": "mediapipe-pose-full/0.10.14",
                     "calibrationVersion": "none", "producedAt": "2026-10-20T09:00:00Z", "referenceFileVersion": "posture-reference/v0-draft"}
    }
    """#

    private func map(_ json: String = releasedBody, titles: [String: String] = [:]) throws -> AssessmentReport {
        let body = try JSONDecoder().decode(AssessmentReportBody.self, from: Data(json.utf8))
        return AssessmentReport(body: body, stepTitles: titles)
    }

    func testHeaderFields() throws {
        let report = try map()
        XCTAssertEqual(report.id, "r1")
        XCTAssertEqual(report.status, .released)
        XCTAssertEqual(report.signedAt, ISO8601.date(from: "2026-10-20T10:00:00.000Z"))
        XCTAssertEqual(report.producedAt, ISO8601.date(from: "2026-10-20T09:00:00Z"))
        XCTAssertTrue(report.referenceFileIsDraft)
        XCTAssertEqual(report.clinicianAssessment, "Reviewed with the patient.")
    }

    func testRowsAreGroupedByStepInOrderWithTitles() throws {
        let report = try map(titles: ["static.anterior": "Front view"])
        XCTAssertEqual(report.sections.map(\.id), ["static.anterior", "static.left_lateral"])
        XCTAssertEqual(report.sections[0].title, "Front view")
        XCTAssertEqual(report.sections[1].title, "Left side", "known static steps have a fallback title")
    }

    func testIndeterminateProxyRow() throws {
        let row = try map().sections[0].rows[0]
        XCTAssertEqual(row.metric, "Shoulder line tilt")
        XCTAssertEqual(row.tier, .proxy)
        XCTAssertEqual(row.unit, "°")
        XCTAssertEqual(row.estimate?.value, 1.2)
        XCTAssertEqual(row.estimate?.uncertainty, 0.8)
        XCTAssertEqual(row.position, .indeterminate)
        XCTAssertEqual(row.reference?.bounds, 0...0)
        XCTAssertEqual(row.reference?.label, "0")
        XCTAssertEqual(row.reference?.source, "Level line (definition)")
        XCTAssertEqual(row.reference?.isDraft, true)
        XCTAssertEqual(row.analysis?.text, "1.2° ± 0.8°; the uncertainty overlaps the 0° reference.")
    }

    func testNoReferenceRowHasNoReferenceAndNamesTheSide() throws {
        let row = try map().sections[0].rows[1]
        XCTAssertEqual(row.metric, "Knee frontal alignment · Left")
        XCTAssertEqual(row.position, .noReference)
        XCTAssertNil(row.reference)
        XCTAssertNotNil(row.estimate)
    }

    func testNotApplicableRowShowsReasonsInPlainWords() throws {
        let row = try map().sections[0].rows[2]
        XCTAssertEqual(row.position, .notApplicable)
        XCTAssertNil(row.estimate)
        XCTAssertEqual(row.unit, "%")
        XCTAssertEqual(row.unsupportedReasons, [
            "Part of the body was outside the frame",
            "There was too much movement during the hold",
        ])
    }

    func testRangeReferenceParsesFromItsLabel() throws {
        let row = try map().sections[1].rows[0]
        XCTAssertEqual(row.position, .above)
        XCTAssertEqual(row.tier, .estimate)
        XCTAssertEqual(row.reference?.bounds, 0...5)
        XCTAssertEqual(row.reference?.label, "0–5")
    }

    func testExcludedRowsAreLeftOutAndCounted() throws {
        let report = try map()
        XCTAssertEqual(report.sections[1].rows.map(\.id), ["static.left_lateral|static.trunk_inclination|"])
        XCTAssertEqual(report.excludedCount, 1)
    }

    func testExplicitBoundsWinOverTheLabel() {
        let ref = AssessmentReport.Reference(
            body: .init(kind: "literature", label: "about zero", sourceCitation: "x", status: "approved", value: nil, min: -1, max: 3)
        )
        XCTAssertEqual(ref.bounds, -1...3)
        XCTAssertFalse(ref.isDraft)
        XCTAssertNil(AssessmentReport.Reference(
            body: .init(kind: "geometric", label: "level", sourceCitation: "x", status: "draft", value: nil, min: nil, max: nil)
        ).bounds)
    }

    func testNotMeasurableListIsMapped() throws {
        let items = try map().notMeasurable
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].label, "Craniovertebral angle")
        XCTAssertEqual(items[0].reason, "Needs a marker on C7")
        XCTAssertEqual(items[0].whatWouldBeNeeded, "A C7 skin marker and a lateral photo")
    }

    func testApprovedReferencesAreNotDraft() throws {
        let json = Self.releasedBody.replacingOccurrences(of: #""status": "draft""#, with: #""status": "approved""#)
        XCTAssertFalse(try map(json).referenceFileIsDraft)
    }

    func testRowsWithoutAStepAreGroupedByModule() throws {
        let json = Self.releasedBody.replacingOccurrences(of: #""stepId": "static.left_lateral","#, with: "")
        let report = try map(json)
        XCTAssertEqual(report.sections.map(\.title), ["Front view", "Standing posture"])
    }

    func testUnknownReasonFallsBackToReadableText() {
        XCTAssertEqual(QualityReasonText.plain("some_new_reason"), "Some new reason")
        XCTAssertEqual(QualityReasonText.plain("camera_not_level"), "The phone was not level")
    }

    func testFixedAppWordingStaysDescriptive() {
        let banned = ["normal", "abnormal", "risk", "score", "optimal", "excellent", "perfect", "textbook",
                      "poor posture", "bad posture", "good posture", "indicates", "diagnos", "healthy", "ideal"]
        var texts = AssessmentReport.Position.allCases.map(\.label)
        texts += AssessmentReport.Tier.allCases.map(\.label)
        texts += QualityReasonText.known.values
        texts += AssessmentReport.fixedCopy
        for text in texts {
            for phrase in banned {
                XCTAssertFalse(text.lowercased().contains(phrase), "\"\(text)\" contains \"\(phrase)\"")
            }
        }
    }
}
