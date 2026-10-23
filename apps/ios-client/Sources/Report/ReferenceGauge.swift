import SwiftUI

/// A measurement scale for the dark readout: the reference (band for a range,
/// tick for a single value), the estimate as a marker, and its uncertainty as
/// a whisker. Without a reference the scale shows only the estimate and its
/// whisker - no band is invented. Deliberately colour-neutral - no good/bad
/// colouring.
struct ReferenceGauge: View {
    let estimate: AssessmentReport.Estimate
    let reference: AssessmentReport.Reference?
    let unit: String

    @State private var revealed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var bounds: ClosedRange<Double>? { reference?.bounds }

    private var window: ClosedRange<Double> {
        guard let ref = bounds else {
            let reach = max(estimate.uncertainty * 2.5, abs(estimate.value) * 0.5, 4)
            return (estimate.value - reach)...(estimate.value + reach)
        }
        let reach = max(
            abs(estimate.value - ref.lowerBound) + estimate.uncertainty,
            abs(estimate.value - ref.upperBound) + estimate.uncertainty,
            (ref.upperBound - ref.lowerBound) / 2 + 4,
            8
        ) * 1.25
        let center = (ref.lowerBound + ref.upperBound) / 2
        return (center - reach)...(center + reach)
    }

    private func x(_ value: Double, in width: CGFloat) -> CGFloat {
        let w = window
        let t = (value - w.lowerBound) / (w.upperBound - w.lowerBound)
        return CGFloat(min(max(t, 0), 1)) * width
    }

    var body: some View {
        VStack(spacing: 6) {
            GeometryReader { geo in
                let width = geo.size.width
                let midY = geo.size.height / 2
                let start = bounds.map { ($0.lowerBound + $0.upperBound) / 2 } ?? estimate.value
                let shown = revealed ? estimate.value : start

                ZStack(alignment: .topLeading) {
                    // Track
                    Capsule()
                        .fill(Theme.readoutRule)
                        .frame(height: 3)
                        .offset(y: midY - 1.5)

                    // Reference band or tick
                    if let ref = bounds {
                        if ref.lowerBound == ref.upperBound {
                            Rectangle()
                                .fill(Theme.readoutDim)
                                .frame(width: 2, height: 18)
                                .offset(x: x(ref.lowerBound, in: width) - 1, y: midY - 9)
                        } else {
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Theme.readoutAccent.opacity(0.18))
                                .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(Theme.readoutAccent.opacity(0.35), lineWidth: 1))
                                .frame(width: max(x(ref.upperBound, in: width) - x(ref.lowerBound, in: width), 2), height: 14)
                                .offset(x: x(ref.lowerBound, in: width), y: midY - 7)
                        }
                    }

                    // Uncertainty whisker
                    let lo = x(shown - estimate.uncertainty, in: width)
                    let hi = x(shown + estimate.uncertainty, in: width)
                    Capsule()
                        .fill(Theme.readoutText.opacity(0.55))
                        .frame(width: max(hi - lo, 2), height: 2)
                        .offset(x: lo, y: midY - 1)

                    // Estimate marker
                    Circle()
                        .fill(Theme.readoutText)
                        .overlay(Circle().strokeBorder(Theme.readout, lineWidth: 2))
                        .frame(width: 13, height: 13)
                        .shadow(color: Theme.readoutAccent.opacity(0.7), radius: 6)
                        .offset(x: x(shown, in: width) - 6.5, y: midY - 6.5)
                }
            }
            .frame(height: 22)

            HStack {
                Text(AssessmentReport.format(window.lowerBound.rounded()) + unit)
                Spacer()
                if let reference, bounds != nil {
                    Text("ref " + reference.label + unit)
                        .foregroundColor(Theme.readoutAccent)
                } else {
                    Text("no reference")
                }
                Spacer()
                Text(AssessmentReport.format(window.upperBound.rounded()) + unit)
            }
            .font(.system(size: 10, design: .monospaced))
            .foregroundColor(Theme.readoutDim)
        }
        .onAppear {
            if reduceMotion {
                revealed = true
            } else {
                withAnimation(.spring(response: 0.7, dampingFraction: 0.8).delay(0.15)) { revealed = true }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "Estimate \(AssessmentReport.format(estimate.value)) \(unit), plus or minus \(AssessmentReport.format(estimate.uncertainty)). "
                + (reference.map { "Reference \($0.label) \(unit)." } ?? "No reference.")
        )
    }
}


/// Per-rep dot plot for movement rows: one dot per rep on the same scale as the
/// reference band. Dots, not bars - bars on a cropped axis would exaggerate
/// small rep-to-rep differences.
struct RepStrip: View {
    let reps: [Double]
    let reference: AssessmentReport.Reference?
    let unit: String

    private var window: ClosedRange<Double> {
        let ref = reference?.bounds
        let lo = min(reps.min() ?? 0, ref?.lowerBound ?? .infinity)
        let hi = max(reps.max() ?? 1, ref?.upperBound ?? -.infinity)
        let pad = max((hi - lo) * 0.15, 2)
        return (lo - pad)...(hi + pad)
    }

    var body: some View {
        GeometryReader { geo in
            let plotHeight = geo.size.height - 18
            let width = geo.size.width
            let w = window
            let y: (Double) -> CGFloat = { CGFloat(1 - ($0 - w.lowerBound) / (w.upperBound - w.lowerBound)) * plotHeight }
            let x: (Int) -> CGFloat = { width * (CGFloat($0) + 0.5) / CGFloat(reps.count) }

            ZStack(alignment: .topLeading) {
                if let ref = reference?.bounds {
                    if ref.lowerBound < ref.upperBound {
                        Rectangle()
                            .fill(Theme.readoutAccent.opacity(0.14))
                            .overlay(alignment: .top) { Rectangle().fill(Theme.readoutAccent.opacity(0.35)).frame(height: 1) }
                            .overlay(alignment: .bottom) { Rectangle().fill(Theme.readoutAccent.opacity(0.35)).frame(height: 1) }
                            .frame(width: width, height: y(ref.lowerBound) - y(ref.upperBound))
                            .offset(y: y(ref.upperBound))
                        Text("ref " + (reference?.label ?? "") + unit)
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundColor(Theme.readoutAccent)
                            .offset(x: 2, y: y(ref.upperBound) + 2)
                    } else {
                        Rectangle().fill(Theme.readoutDim).frame(width: width, height: 1).offset(y: y(ref.lowerBound))
                    }
                }

                Path { path in
                    for (i, v) in reps.enumerated() {
                        let p = CGPoint(x: x(i), y: y(v))
                        i == 0 ? path.move(to: p) : path.addLine(to: p)
                    }
                }
                .stroke(Theme.readoutText.opacity(0.3), lineWidth: 1.5)

                ForEach(Array(reps.enumerated()), id: \.offset) { i, v in
                    Circle()
                        .fill(Theme.readoutText)
                        .overlay(Circle().strokeBorder(Theme.readout, lineWidth: 2))
                        .frame(width: 11, height: 11)
                        .offset(x: x(i) - 5.5, y: y(v) - 5.5)
                    Text(AssessmentReport.format(v))
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(Theme.readoutText)
                        .fixedSize()
                        .frame(width: 40)
                        .offset(x: x(i) - 20, y: y(v) - 22)
                    Text("R\(i + 1)")
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .foregroundColor(Theme.readoutDim)
                        .frame(width: 40)
                        .offset(x: x(i) - 20, y: plotHeight + 4)
                }
            }
        }
        .frame(height: 118)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Per rep: " + reps.enumerated().map { "rep \($0.offset + 1) \(AssessmentReport.format($0.element)) \(unit)" }.joined(separator: ", "))
    }
}
