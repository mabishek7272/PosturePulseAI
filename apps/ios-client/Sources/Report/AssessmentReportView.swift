import SwiftUI

/// The patient-facing report: light paper header, then one dark "readout"
/// panel per section with Metric / Your scan / Ideal and the System Analysis
/// sentence under each row (spec §3, §7).
struct AssessmentReportView: View {
    let report: AssessmentReport

    @State private var appeared = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                legend
                ForEach(Array(report.sections.enumerated()), id: \.element.id) { index, section in
                    ReadoutPanel(section: section, referenceIsDraft: report.referenceFileIsDraft)
                        .opacity(appeared ? 1 : 0)
                        .offset(y: appeared ? 0 : 16)
                        .animation(reduceMotion ? nil : .easeOut(duration: 0.5).delay(0.08 * Double(index)), value: appeared)
                }
                footnote
            }
            .padding(.horizontal, Theme.gutter)
            .padding(.bottom, 32)
        }
        .paperBackground()
        .onAppear { appeared = true }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow("Assessment report", color: Theme.brand)
            Text("Posture & movement")
                .font(Typo.hero)
                .foregroundColor(Theme.ink)
            Text(report.producedAt.formatted(date: .long, time: .shortened))
                .font(Typo.caption.monospacedDigit())
                .foregroundColor(Theme.inkSoft)
            if report.status == .released, let releasedBy = report.releasedBy {
                Label("Reviewed and released by \(releasedBy)", systemImage: "checkmark.seal")
                    .font(.footnote.weight(.semibold))
                    .foregroundColor(Theme.brand)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(Capsule().fill(Theme.brandTint))
            }
            Text("Camera-based estimates of visible body angles. Your clinician interprets these results with you.")
                .font(Typo.caption)
                .foregroundColor(Theme.inkSoft)
        }
        .padding(.top, 12)
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

    private var footnote: some View {
        VStack(alignment: .leading, spacing: 6) {
            if report.referenceFileIsDraft {
                Text("“Ideal” values come from a draft reference file that has not yet been signed off by a clinical lead.")
            }
            Text("“Not measured” means the camera view was not good enough to estimate that value; nothing is guessed.")
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
                    Eyebrow(section.subtitle, color: Theme.readoutDim)
                    Text(section.title)
                        .font(Typo.title)
                        .foregroundColor(Theme.readoutText)
                }
                Spacer(minLength: 8)
                if referenceIsDraft && section.rows.contains(where: { $0.reference != nil }) {
                    Text("DRAFT IDEALS")
                        .font(.system(size: 9, weight: .heavy))
                        .tracking(0.8)
                        .foregroundColor(Theme.draft)
                        .padding(.horizontal, 7).padding(.vertical, 4)
                        .background(Capsule().fill(Theme.draftTint))
                        .fixedSize()
                        .accessibilityLabel("Ideal values are draft references")
                }
            }
            .padding(.bottom, 14)

            HStack {
                Eyebrow("Metric", color: Theme.readoutDim)
                Spacer()
                Eyebrow("Your scan", color: Theme.readoutDim)
                    .fixedSize()
                    .frame(width: 92, alignment: .trailing)
                Eyebrow("Ideal", color: Theme.readoutDim)
                    .fixedSize()
                    .frame(width: 72, alignment: .trailing)
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
                Text(row.metric)
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(Theme.readoutText)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                valueColumn
                    .frame(width: 92, alignment: .trailing)
                Text(row.reference.map { $0.label + row.unit } ?? "—")
                    .font(Typo.readout(.subheadline))
                    .foregroundColor(Theme.readoutDim)
                    .frame(width: 72, alignment: .trailing)
            }

            if let estimate = row.estimate, let reference = row.reference {
                if let reps = row.reps {
                    RepStrip(reps: reps, reference: reference, unit: row.unit)
                } else {
                    ReferenceGauge(estimate: estimate, reference: reference, unit: row.unit)
                }
            } else {
                notMeasured
            }

            if let analysis = row.analysis {
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
                if let reason = row.unsupportedReason {
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
