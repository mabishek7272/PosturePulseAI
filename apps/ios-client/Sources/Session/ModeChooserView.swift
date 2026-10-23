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
                            let threshold = height * 0.18
                            if value.translation.height < -threshold, selection == .clinic {
                                selection = .patient
                            } else if value.translation.height > threshold, selection == .patient {
                                selection = .clinic
                            }
                            withAnimation(.easeOut(duration: 0.3)) { dragOffset = 0 }
                        }
                )
                .animation(.easeOut(duration: 0.3), value: selection)

                dots
            }
            .clipped()
        }
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var dots: some View {
        VStack(spacing: 7) {
            ForEach(SessionMode.allCases) { mode in
                Capsule()
                    .fill(mode == selection ? NeonTheme.violet : NeonTheme.violet.opacity(0.3))
                    .frame(width: 7, height: mode == selection ? 20 : 7)
                    .shadow(color: mode == selection ? NeonTheme.violet.opacity(0.7) : .clear, radius: 6)
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.25), value: selection)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
        .padding(.trailing, 14)
        .allowsHitTesting(false)
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
