import SwiftUI

/// Guided capture chrome (spec §5): step track, framing stage, level check,
/// hold ring / rep counter and quality prompts. Steps come from the battery
/// (data-driven). The camera feed and the stop control are injected, so the
/// local-first SymptomStopButton stays the only stop implementation. Never
/// shows a measured number - the level shows a bubble and a word only.
struct GuidedCaptureView<Stage: View, Stop: View>: View {
    struct CaptureState: Equatable {
        var stepIndex: Int
        var instruction: String
        var detail: String
        /// The single most important guidance message right now, or nil when
        /// nothing needs correcting. Shown as a non-blocking top banner, never
        /// a full-screen block.
        var toast: CaptureToast?
        /// 0...1 progress of the current hold; nil for rep-based steps.
        var holdProgress: Double?
        var repCount: Int?
        var repTarget: Int?
        /// Shown only while actually recording (separate from `toast`, which is
        /// pre-recording guidance only).
        var recordingPrompt: String?
    }

    /// Short step titles for the step track.
    let steps: [String]
    let state: CaptureState
    @ViewBuilder let stage: () -> Stage
    @ViewBuilder let stop: () -> Stop


    var body: some View {
        VStack(spacing: 16) {
            StepTrack(steps: steps, current: state.stepIndex)
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

            GeometryReader { geo in
                ZStack {
                    stage()
                    FramingBrackets()
                        .stroke(Theme.readoutText.opacity(0.85), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .padding(12)

                    VStack {
                        HStack {
                            statusRow
                            Spacer()
                            progressBadge
                        }
                        if let toast = state.toast {
                            CaptureGuidanceToast(toast: toast)
                                .padding(.top, 10)
                                .transition(.move(edge: .top).combined(with: .opacity))
                        }
                        Spacer()
                        if let prompt = state.recordingPrompt {
                            Label(prompt, systemImage: "record.circle")
                                .font(.subheadline.weight(.semibold))
                                .foregroundColor(Theme.ink)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 10)
                                .background(Capsule().fill(.white))
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                        }
                    }
                    .padding(16)
                }
                .frame(width: geo.size.width, height: geo.size.height)
            }
            // Nothing is ever cropped from what the pipeline sees - the frame just
            // fills nearly all available space instead of a boxed 4:5 rectangle.
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.readout)
            .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
            .animation(.easeOut(duration: 0.25), value: state.toast)
            .animation(.easeOut(duration: 0.25), value: state.recordingPrompt)

            stop()
        }
        .padding(.horizontal, Theme.gutter)
            .readableColumn()
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .paperBackground()
    }

    private var statusRow: some View {
        // Replaces the old LevelIndicator bubble: a quiet status dot, no text
        // duplicating what the toast already says when something's wrong.
        Circle()
            .fill(state.toast == nil ? Theme.readoutText : Theme.readoutAccent)
            .frame(width: 10, height: 10)
            .padding(10)
            .background(Capsule().fill(Theme.readout.opacity(0.75)))
            .accessibilityLabel(state.toast == nil ? "Ready" : "Needs adjustment")
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

/// Non-blocking top banner for the single most important guidance issue.
/// Never covers the skeleton or the hold-ring.
private struct CaptureGuidanceToast: View {
    let toast: CaptureToast

    var body: some View {
        Label(toast.text, systemImage: toast.icon)
            .font(.subheadline.weight(.semibold))
            .foregroundColor(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Capsule().fill(Color.black.opacity(0.55)))
            .accessibilityElement(children: .combine)
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
