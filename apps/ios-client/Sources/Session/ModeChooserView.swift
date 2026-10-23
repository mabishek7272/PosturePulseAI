import SwiftUI

/// First screen of every session: Clinic mode or Patient mode. A vertically
/// swipeable full-bleed pager
/// (docs/superpowers/specs/2026-10-23-neon-shell-redesign-design.md §4.3) -
/// swipe up/down between modes, tap the visible page to choose it.
struct ModeChooserView: View {
    let onChoose: (SessionMode) -> Void
    /// Set when this phone holds access to at least one assessment's results.
    var onViewResults: (() -> Void)?

    @State private var selection: SessionMode = .clinic

    var body: some View {
        VStack(spacing: 0) {
            pager
            footer
        }
        .background(NeonTheme.bgDeep.ignoresSafeArea())
    }

    @State private var dragOffset: CGFloat = 0
    @State private var wipeIncoming: SessionMode?
    @State private var wipeProgress: CGFloat = 0
    @State private var legendDotAtTop = false

    private var pager: some View {
        GeometryReader { geo in
            let height = geo.size.height
            ZStack {
                VStack(spacing: 0) {
                    ModePage(mode: .clinic, onChoose: { onChoose(.clinic) })
                        .frame(height: height)
                        .accessibilityHidden(selection != .clinic)
                    ModePage(mode: .patient, onChoose: { onChoose(.patient) })
                        .frame(height: height)
                        .accessibilityHidden(selection != .patient)
                }
                .offset(y: (selection == .clinic ? 0 : -height) + dragOffset)
                .gesture(
                    DragGesture(minimumDistance: 10)
                        .onChanged { value in
                            dragOffset = value.translation.height
                        }
                        .onEnded { value in
                            guard wipeIncoming == nil else { return }
                            let threshold = height * 0.18
                            let next: SessionMode? =
                                value.translation.height < -threshold && selection == .clinic ? .patient :
                                value.translation.height > threshold && selection == .patient ? .clinic : nil
                            guard let next else {
                                withAnimation(.easeOut(duration: 0.3)) { dragOffset = 0 }
                                return
                            }
                            dragOffset = 0
                            if reduceMotion {
                                selection = next
                            } else {
                                wipeIncoming = next
                                wipeProgress = 0
                                withAnimation(.easeInOut(duration: 0.45)) { wipeProgress = 1 }
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
                                    selection = next
                                    wipeIncoming = nil
                                    wipeProgress = 0
                                }
                            }
                        }
                )
                .animation(.easeOut(duration: 0.3), value: selection)

                if let wipeIncoming {
                    ModePage(mode: wipeIncoming, onChoose: { onChoose(wipeIncoming) })
                        .frame(height: height)
                        .clipShape(DiagonalWipe(progress: wipeProgress))
                        .allowsHitTesting(false)
                }

                gestureLegend

                Text("SWIPE TO SWITCH")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.5)
                    .foregroundColor(NeonTheme.textDim)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .padding(.top, 44)
                    .allowsHitTesting(false)
            }
            .frame(width: geo.size.width, height: height)
            .clipped()
        }
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var gestureLegend: some View {
        VStack(spacing: 3) {
            Text("▲")
                .font(.system(size: 11))
                .foregroundColor(NeonTheme.textPrimary.opacity(0.55))
            Text("PATIENT")
                .font(.system(size: 8.5, weight: .semibold))
                .tracking(0.5)
                .foregroundColor(NeonTheme.violetDim)
                .fixedSize()
            ZStack(alignment: .top) {
                Capsule()
                    .fill(NeonTheme.violet.opacity(0.25))
                    .frame(width: 2, height: 70)
                Circle()
                    .fill(NeonTheme.mint)
                    .frame(width: 6, height: 6)
                    .shadow(color: NeonTheme.mint.opacity(0.7), radius: 4)
                    .offset(y: reduceMotion ? 35 : (legendDotAtTop ? 0 : 64))
                    .animation(reduceMotion ? nil : .easeInOut(duration: 1.5).repeatForever(autoreverses: true), value: legendDotAtTop)
            }
            Text("CLINIC")
                .font(.system(size: 8.5, weight: .semibold))
                .tracking(0.5)
                .foregroundColor(NeonTheme.violetDim)
                .fixedSize()
            Text("▼")
                .font(.system(size: 11))
                .foregroundColor(NeonTheme.textPrimary.opacity(0.55))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
        .padding(.trailing, 14)
        .allowsHitTesting(false)
        .onAppear {
            guard !reduceMotion else { return }
            legendDotAtTop = true
        }
    }

    private var footer: some View {
        VStack(spacing: 10) {
            if let onViewResults {
                Button(action: onViewResults) {
                    Label("Your results", systemImage: "doc.text.magnifyingglass")
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(NeonTheme.textPrimary)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .accessibilityHint("Shows assessments your clinician has released")
            }
            Text("Results are camera-based estimates that a clinician reviews.")
                .font(.footnote)
                .foregroundColor(NeonTheme.textDim)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, Theme.gutter)
        .padding(.top, 10)
        .padding(.bottom, 18)
        .background(NeonTheme.bgDeep)
    }
}

private struct ModePage: View {
    let mode: SessionMode
    let onChoose: () -> Void

    var body: some View {
        Button(action: onChoose) {
            ZStack {
                RadialGradient(
                    colors: [NeonTheme.bgGlow, NeonTheme.bgDeep],
                    center: mode == .clinic ? .topLeading : .bottomTrailing,
                    startRadius: 0, endRadius: 420
                )
                DotGrid()
                FloatingOrb(corner: mode == .clinic ? .topTrailing : .bottomLeading, color: NeonTheme.violet)
                VStack(spacing: 14) {
                    icon
                    Text(mode.title)
                        .font(NeonTypo.heading)
                        .foregroundColor(NeonTheme.textPrimary)
                    Text(mode.detail)
                        .font(NeonTypo.body)
                        .foregroundColor(NeonTheme.textDim)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 260)
                }
                .padding(28)
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Starts a session in \(mode.title)")
    }

    private var icon: some View {
        Circle()
            .fill(NeonTheme.violet.opacity(0.15))
            .overlay(Circle().strokeBorder(NeonTheme.violet.opacity(0.5), lineWidth: 1))
            .frame(width: 60, height: 60)
            .overlay(Image(systemName: mode.icon).font(.title2).foregroundColor(NeonTheme.violet))
            .shadow(color: NeonTheme.violet.opacity(0.4), radius: 14)
    }
}

/// A faint, slowly-drifting field of dots behind a mode panel, for depth
/// (spec §4.3). Static (not animated) under Reduce Motion.
private struct DotGrid: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = 0

    var body: some View {
        Canvas { context, size in
            let spacing: CGFloat = 16
            var y = -spacing + phase.truncatingRemainder(dividingBy: spacing)
            while y < size.height + spacing {
                var x = -spacing + phase.truncatingRemainder(dividingBy: spacing)
                while x < size.width + spacing {
                    context.fill(Path(ellipseIn: CGRect(x: x, y: y, width: 1.5, height: 1.5)), with: .color(NeonTheme.violet.opacity(0.35)))
                    x += spacing
                }
                y += spacing
            }
        }
        .opacity(0.5)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 6).repeatForever(autoreverses: false)) { phase = 32 }
        }
        .allowsHitTesting(false)
    }
}

/// A soft, slowly floating blurred circle in one corner of a mode panel, for
/// depth (spec §4.3). Static under Reduce Motion.
private struct FloatingOrb: View {
    enum Corner { case topTrailing, bottomLeading }
    let corner: Corner
    let color: Color

    @State private var floated = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 140, height: 140)
            .blur(radius: 30)
            .opacity(0.5)
            .offset(y: !reduceMotion && floated ? 14 : 0)
            .scaleEffect(!reduceMotion && floated ? 1.12 : 1)
            .animation(reduceMotion ? nil : .easeInOut(duration: 3).repeatForever(autoreverses: true), value: floated)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: corner == .topTrailing ? .topTrailing : .bottomLeading)
            .offset(x: corner == .topTrailing ? 30 : -20, y: corner == .topTrailing ? -30 : 30)
            .onAppear { floated = true }
            .allowsHitTesting(false)
    }
}

/// A diagonal-edged region used for the mode-chooser's swipe transition: the
/// edge slopes from `y` on the left to a point `slant` higher on the right.
/// At progress 0 the edge sits below the frame (nothing revealed); at
/// progress 1 it sits above the frame (fully revealed). `Animatable` so
/// SwiftUI can interpolate it smoothly inside a `withAnimation` block.
private struct DiagonalWipe: Shape {
    var progress: CGFloat
    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let slant = rect.height * 0.22
        let span = rect.height + slant
        let leftY = rect.height + slant - progress * span
        let rightY = leftY - slant
        var path = Path()
        path.move(to: CGPoint(x: 0, y: leftY))
        path.addLine(to: CGPoint(x: rect.width, y: rightY))
        path.addLine(to: CGPoint(x: rect.width, y: rect.height))
        path.addLine(to: CGPoint(x: 0, y: rect.height))
        path.closeSubpath()
        return path
    }
}
