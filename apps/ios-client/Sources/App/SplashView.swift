import SwiftUI

/// Shown once per app launch, before the mode chooser - a fixed ~1.2s brand
/// moment, never a loading gate (nothing it shows depends on a network call;
/// RootView's battery fetch still runs where it already did, after this hands
/// off). docs/superpowers/specs/2026-10-23-neon-shell-redesign-design.md §4.2.
struct SplashView: View {
    let onFinished: () -> Void

    @State private var pulse = false
    @State private var visible = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            NeonTheme.bgDeep.ignoresSafeArea()
            RadialGradient(colors: [NeonTheme.bgGlow, NeonTheme.bgDeep], center: .center, startRadius: 0, endRadius: 280)
                .ignoresSafeArea()

            if !reduceMotion {
                Circle()
                    .strokeBorder(NeonTheme.violet.opacity(0.4), lineWidth: 1)
                    .frame(width: 150, height: 150)
                    .scaleEffect(pulse ? 1.6 : 0.6)
                    .opacity(pulse ? 0 : 0.9)
                    .animation(.easeOut(duration: 1.1).repeatForever(autoreverses: false), value: pulse)
            }

            VStack(spacing: 14) {
                // BrandLogo's source PNG is opaque (no alpha channel), so it's shown on its
                // own white badge rather than composited directly onto the dark background,
                // where an opaque image would otherwise appear as a plain white box.
                Image("BrandLogo")
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .frame(width: 52, height: 52)
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Color.white))
                    .shadow(color: NeonTheme.violet.opacity(0.55), radius: reduceMotion ? 10 : 20)
                    .scaleEffect(!reduceMotion && pulse ? 1.06 : 1)
                    .animation(reduceMotion ? nil : .easeInOut(duration: 1.1).repeatForever(autoreverses: true), value: pulse)
                    .accessibilityHidden(true)

                Text("POSTUREPULSE")
                    .font(NeonTypo.heading)
                    .tracking(1)
                    .foregroundColor(NeonTheme.textPrimary)
                Text("Clinician-supervised assessment")
                    .font(NeonTypo.caption)
                    .foregroundColor(NeonTheme.textDim)
            }
        }
        .opacity(visible ? 1 : 0)
        .onAppear { pulse = true }
        .task {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { visible = false }
            try? await Task.sleep(nanoseconds: 200_000_000)
            onFinished()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("PosturePulse")
    }
}
