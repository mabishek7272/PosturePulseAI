import SwiftUI

/// The patient-facing report: light paper header, the clinician's assessment,
/// then one dark "readout" panel per battery step with Metric / Your scan /
/// Reference, the row's position against the reference and its fixed-wording
/// sentence, and finally the standing list of what this system cannot measure
/// (ADR-015). Colour-neutral throughout: position is text and a marker on a
/// scale, never a good/bad colour.
struct AssessmentReportView: View {
    let report: AssessmentReport

    @State private var appeared = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var allRows: [AssessmentReport.Row] { report.sections.flatMap(\.rows) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                if let assessment = report.clinicianAssessment, !assessment.isEmpty {
                    clinicianAssessment(assessment)
                }
                legend
                ForEach(Array(report.sections.enumerated()), id: \.element.id) { index, section in
                    ReadoutPanel(section: section, referenceIsDraft: report.referenceFileIsDraft)
                        .opacity(appeared ? 1 : 0)
                        .offset(y: appeared ? 0 : 16)
                        .animation(reduceMotion ? nil : .easeOut(duration: 0.5).delay(0.08 * Double(index)), value: appeared)
                }
                if !report.notMeasurable.isEmpty {
                    notMeasurableList
                }
                footnote
            }
            .padding(.horizontal, Theme.gutter)
            .readableColumn()
            .padding(.bottom, 32)
        }
        .paperBackground()
        .onAppear { appeared = true }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow("Assessment report", color: Theme.brand)
            Text("Standing posture")
                .font(Typo.hero)
                .foregroundColor(Theme.ink)
            Text(report.producedAt.formatted(date: .long, time: .shortened))
                .font(Typo.caption.monospacedDigit())
                .foregroundColor(Theme.inkSoft)
            switch report.status {
            case .released:
                Label(
                    report.signedAt.map { "Reviewed and released by your clinician on \($0.formatted(date: .abbreviated, time: .omitted))" }
                        ?? "Reviewed and released by your clinician",
                    systemImage: "checkmark.seal"
                )
                .font(.footnote.weight(.semibold))
                .foregroundColor(Theme.brand)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Capsule().fill(Theme.brandTint))
            case .draft:
                Label("Draft - not yet reviewed by a clinician", systemImage: "doc.badge.clock")
                    .font(.footnote.weight(.semibold))
                    .foregroundColor(Theme.draft)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(Capsule().fill(Theme.draftTint))
            case .rejected:
                Label("Not released", systemImage: "doc")
                    .font(.footnote.weight(.semibold))
                    .foregroundColor(Theme.inkSoft)
            }
            if report.referenceFileIsDraft {
                DraftBadge()
            }
            Text(AssessmentReport.introCopy)
                .font(Typo.caption)
                .foregroundColor(Theme.inkSoft)
        }
        .padding(.top, 12)
    }

    private func clinicianAssessment(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow("Clinician's assessment", color: Theme.brand)
            Text(text)
                .font(.body)
                .foregroundColor(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .card()
    }

    private var legend: some View {
        HStack(spacing: 18) {
            LegendItem(label: "Your estimate") {
                Circle().fill(Theme.ink).frame(width: 10, height: 10)
            }
            LegendItem(label: "Uncertainty") {
                Capsule().fill(Theme.inkSoft).frame(width: 22, height: 2)
            }
            LegendItem(label: "Reference") {
                RoundedRectangle(cornerRadius: 2).fill(Theme.brand.opacity(0.25)).frame(width: 22, height: 10)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private var notMeasurableList: some View {
        VStack(alignment: .leading, spacing: 12) {
            Eyebrow("Not measured by this system")
            Text(AssessmentReport.notMeasurableCopy)
                .font(.footnote)
                .foregroundColor(Theme.inkSoft)
            ForEach(report.notMeasurable) { item in
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.label).font(.subheadline.weight(.semibold)).foregroundColor(Theme.ink)
                    Text(item.reason).font(.footnote).foregroundColor(Theme.inkSoft)
                    Text("Would need: " + item.whatWouldBeNeeded).font(.footnote).foregroundColor(Theme.inkSoft)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if item.id != report.notMeasurable.last?.id {
                    Rectangle().fill(Theme.hairline).frame(height: 1)
                }
            }
        }
        .card()
    }

    private var footnote: some View {
        VStack(alignment: .leading, spacing: 6) {
            if report.referenceFileIsDraft {
                Text(AssessmentReport.draftReferenceCopy)
            }
            if allRows.contains(where: { $0.tier == .proxy }) {
                Text(AssessmentReport.proxyCopy)
            }
            if allRows.contains(where: { $0.unit == "%" }) {
                Text(AssessmentReport.percentCopy)
            }
            Text(AssessmentReport.notMeasuredCopy)
            if report.excludedCount > 0 {
                Text(report.excludedCount == 1
                     ? "Your clinician left out 1 measurement when reviewing this report."
                     : "Your clinician left out \(report.excludedCount) measurements when reviewing this report.")
            }
        }
        .font(.caption)
        .foregroundColor(Theme.inkSoft)
    }
}

private struct LegendItem<Swatch: View>: View {
    let label: String
    @ViewBuilder let swatch: () -> Swatch

    var body: some View {
        HStack(spacing: 6) {
            swatch()
            Text(label).font(.caption).foregroundColor(Theme.inkSoft)
        }
    }
}

private struct ReadoutPanel: View {
    let section: AssessmentReport.Section
    let referenceIsDraft: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    if !section.subtitle.isEmpty {
                        Eyebrow(section.subtitle, color: Theme.readoutDim)
                    }
                    Text(section.title)
                        .font(Typo.title)
                        .foregroundColor(Theme.readoutText)
                }
                Spacer(minLength: 8)
                if referenceIsDraft && section.rows.contains(where: { $0.reference?.isDraft == true }) {
                    Text("DRAFT REFERENCES")
                        .font(.system(size: 9, weight: .heavy))
                        .tracking(0.8)
                        .foregroundColor(Theme.draft)
                        .padding(.horizontal, 7).padding(.vertical, 4)
                        .background(Capsule().fill(Theme.draftTint))
                        .fixedSize()
                        .accessibilityLabel("Reference values are drafts")
                }
            }
            .padding(.bottom, 14)

            HStack {
                Eyebrow("Metric", color: Theme.readoutDim)
                Spacer()
                Eyebrow("Your scan", color: Theme.readoutDim)
                    .fixedSize()
                    .frame(width: 92, alignment: .trailing)
                Eyebrow("Reference", color: Theme.readoutDim)
                    .fixedSize()
                    .frame(width: 80, alignment: .trailing)
            }
            .padding(.bottom, 8)

            Rectangle().fill(Theme.readoutRule).frame(height: 1)

            ForEach(section.rows) { row in
                ReadoutRow(row: row)
                if row.id != section.rows.last?.id {
                    Rectangle().fill(Theme.readoutRule).frame(height: 1)
                }
            }
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Theme.readout)
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(
                            RadialGradient(
                                colors: [Theme.brand.opacity(0.35), .clear],
                                center: .topTrailing, startRadius: 0, endRadius: 260
                            )
                        )
                )
        )
        .environment(\.colorScheme, .dark)
    }
}

private struct ReadoutRow: View {
    let row: AssessmentReport.Row

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(row.metric)
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(Theme.readoutText)
                        .fixedSize(horizontal: false, vertical: true)
                    TierChip(tier: row.tier)
                }
                Spacer(minLength: 8)
                valueColumn
                    .frame(width: 92, alignment: .trailing)
                Text(row.reference.map { $0.bounds == nil ? $0.label : $0.label + row.unit } ?? "—")
                    .font(Typo.readout(.subheadline))
                    .foregroundColor(Theme.readoutDim)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 80, alignment: .trailing)
            }

            if let estimate = row.estimate {
                if let reps = row.reps {
                    RepStrip(reps: reps, reference: row.reference, unit: row.unit)
                } else {
                    ReferenceGauge(estimate: estimate, reference: row.reference, unit: row.unit)
                }
                Text(row.position.label.uppercased())
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .tracking(0.8)
                    .foregroundColor(Theme.readoutText.opacity(0.85))
            } else {
                notMeasured
            }

            if let analysis = row.analysis, row.estimate != nil {
                VStack(alignment: .leading, spacing: 6) {
                    Text(analysis.text)
                        .font(.callout)
                        .foregroundColor(Theme.readoutText.opacity(0.92))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(analysis.sourceLabel.uppercased())
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .tracking(0.8)
                        .foregroundColor(Theme.readoutDim)
                }
                .padding(.leading, 10)
                .overlay(alignment: .leading) {
                    Rectangle().fill(Theme.readoutAccent.opacity(0.6)).frame(width: 2)
                }
            }

            if let source = row.reference?.source {
                Text("Reference: " + source)
                    .font(.caption2)
                    .foregroundColor(Theme.readoutDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 16)
    }

    @ViewBuilder
    private var valueColumn: some View {
        if let estimate = row.estimate {
            VStack(alignment: .trailing, spacing: 1) {
                Text(AssessmentReport.format(estimate.value) + row.unit)
                    .font(Typo.readout(.title3))
                    .foregroundColor(Theme.readoutText)
                Text("± " + AssessmentReport.format(estimate.uncertainty) + row.unit)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(Theme.readoutDim)
            }
        } else {
            Text("—")
                .font(Typo.readout(.title3))
                .foregroundColor(Theme.readoutDim)
        }
    }

    private var notMeasured: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "eye.slash")
                .font(.footnote)
                .foregroundColor(Theme.readoutDim)
            VStack(alignment: .leading, spacing: 2) {
                Text("Not measured")
                    .font(.footnote.weight(.semibold))
                    .foregroundColor(Theme.readoutText)
                ForEach(row.unsupportedReasons, id: \.self) { reason in
                    Text(reason)
                        .font(.footnote)
                        .foregroundColor(Theme.readoutDim)
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(Theme.readoutRule, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
        )
    }
}

/// Estimate / Proxy marker on each row - outlined, colour-neutral.
private struct TierChip: View {
    let tier: AssessmentReport.Tier

    var body: some View {
        Text(tier.label.uppercased())
            .font(.system(size: 9, weight: .heavy))
            .tracking(0.8)
            .foregroundColor(Theme.readoutDim)
            .padding(.horizontal, 6).padding(.vertical, 3)
            .overlay(Capsule().strokeBorder(Theme.readoutRule, lineWidth: 1))
            .fixedSize()
            .accessibilityLabel(tier.label)
    }
}
