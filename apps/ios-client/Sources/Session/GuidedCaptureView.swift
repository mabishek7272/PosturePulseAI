import SwiftUI

/// Guided capture chrome (spec §5): step track, framing stage, level check,
/// hold ring / rep counter and quality prompts. The camera feed and the stop
/// control are injected, so the local-first SymptomStopButton stays the only
/// stop implementation.
struct GuidedCaptureView<Stage: View, Stop: View>: View {
    struct CaptureState: Equatable {
        var stepIndex: Int
        var instruction: String
        var detail: String
        /// Device tilt from the step's required orientation, degrees; nil when unknown.
        var tiltDegrees: Double?
        /// 0...1 progress of the current hold; nil for rep-based steps.
        var holdProgress: Double?
        var repCount: Int?
        var repTarget: Int?
        /// Quality-gate prompt, e.g. "Step back — feet not visible".
        var qualityPrompt: String?
    }

    static var steps: [String] { ["Front", "Side", "Squat", "Sit–stand", "Shoulder"] }
    static var levelToleranceDegrees: Double { 3 }

    let state: CaptureState
    @ViewBuilder let stage: () -> Stage
    @ViewBuilder let stop: () -> Stop

    private var isLevel: Bool { (state.tiltDegrees.map { abs($0) <= Self.levelToleranceDegrees }) ?? false }

    var body: some View {
        VStack(spacing: 16) {
            StepTrack(steps: Self.steps, current: state.stepIndex)
                .padding(.top, 8)

            VStack(alignment: .leading, spacing: 6) {
                Text(state.instruction)
                    .font(Typo.title)
                    .foregroundColor(Theme.ink)
                Text(state.detail)
                    .font(.callout)
                    .foregroundColor(Theme.inkSoft)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            ZStack {
                stage()
                FramingBrackets()
                    .stroke(Theme.readoutText.opacity(0.85), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .padding(12)

                VStack {
                    HStack {
                        LevelIndicator(tilt: state.tiltDegrees, isLevel: isLevel)
                        Spacer()
                        progressBadge
                    }
                    Spacer()
                    if let prompt = state.qualityPrompt {
                        Label(prompt, systemImage: "viewfinder")
                            .font(.subheadline.weight(.semibold))
                            .foregroundColor(Theme.ink)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(Capsule().fill(.white))
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .padding(28)
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(3 / 4, contentMode: .fit)
            .background(Theme.readout)
            .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
            .animation(.easeOut(duration: 0.25), value: state.qualityPrompt)

            stop()
        }
        .padding(.horizontal, Theme.gutter)
            .readableColumn()
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .paperBackground()
    }

    @ViewBuilder
    private var progressBadge: some View {
        if let target = state.repTarget {
            VStack(spacing: 0) {
                Text("\(state.repCount ?? 0)")
                    .font(Typo.readout(.largeTitle))
                    .foregroundColor(Theme.readoutText)
                    .contentTransition(.numericText())
                Text("OF \(target) REPS")
                    .font(.system(size: 9, weight: .bold))
                    .tracking(1)
                    .foregroundColor(Theme.readoutDim)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 14).fill(Theme.readout.opacity(0.75)))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(state.repCount ?? 0) of \(target) reps")
        } else if let progress = state.holdProgress {
            HoldRing(progress: progress)
        }
    }
}

/// Corner brackets that frame where the body should be.
private struct FramingBrackets: Shape {
    func path(in rect: CGRect) -> Path {
        let arm: CGFloat = min(rect.width, rect.height) * 0.12
        var p = Path()
        for (corner, dx, dy) in [
            (CGPoint(x: rect.minX, y: rect.minY), 1.0, 1.0), (CGPoint(x: rect.maxX, y: rect.minY), -1.0, 1.0),
            (CGPoint(x: rect.minX, y: rect.maxY), 1.0, -1.0), (CGPoint(x: rect.maxX, y: rect.maxY), -1.0, -1.0),
        ] {
            p.move(to: CGPoint(x: corner.x, y: corner.y + dy * arm))
            p.addLine(to: corner)
            p.addLine(to: CGPoint(x: corner.x + dx * arm, y: corner.y))
        }
        return p
    }
}

/// Bubble level: the bubble drifts with tilt and snaps to centre when within tolerance.
private struct LevelIndicator: View {
    let tilt: Double?
    let isLevel: Bool

    var body: some View {
        HStack(spacing: 8) {
            ZStack {
                Capsule().strokeBorder(Theme.readoutText.opacity(0.6), lineWidth: 1.5).frame(width: 54, height: 16)
                Rectangle().fill(Theme.readoutText.opacity(0.6)).frame(width: 1, height: 16)
                Circle()
                    .fill(isLevel ? Theme.readoutText : Theme.readoutAccent)
                    .frame(width: 10, height: 10)
                    .offset(x: CGFloat(max(min(tilt ?? 0, 10), -10)) * 2)
                    .animation(.spring(response: 0.3), value: tilt)
            }
            Text(tilt == nil ? "Level?" : isLevel ? "Level" : String(format: "%+.0f°", tilt!))
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundColor(Theme.readoutText)
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(Capsule().fill(Theme.readout.opacity(0.75)))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(tilt == nil ? "Phone level unknown" : isLevel ? "Phone is level" : "Phone tilted \(Int(tilt!.rounded())) degrees")
    }
}

private struct HoldRing: View {
    let progress: Double

    var body: some View {
        ZStack {
            Circle().stroke(Theme.readoutRule, lineWidth: 5)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(Theme.readoutText, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 0.2), value: progress)
            Text("HOLD")
                .font(.system(size: 9, weight: .heavy))
                .tracking(1)
                .foregroundColor(Theme.readoutText)
        }
        .frame(width: 54, height: 54)
        .padding(6)
        .background(Circle().fill(Theme.readout.opacity(0.75)))
        .accessibilityLabel("Hold still, \(Int(progress * 100)) percent")
    }
}

/// Placeholder stage for previews: a standing silhouette on the dark stage.
struct SilhouetteStage: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [Theme.readoutRaised, Theme.readout], startPoint: .top, endPoint: .bottom)
            Image(systemName: "figure.stand")
                .resizable()
                .scaledToFit()
                .padding(70)
                .foregroundColor(Theme.readoutText.opacity(0.18))
        }
    }
}

/// Visual stand-in for SymptomStopButton in design previews only.
struct StopControlPreview: View {
    var body: some View {
        Label("Stop – I feel unwell", systemImage: "hand.raised.fill")
            .font(.title3.bold())
            .foregroundColor(.white)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(hex: 0xC4302B)))
    }
}
