import SwiftUI

/// Replaces the swipe mode-chooser as the first screen after splash
/// (ADR-019): a patient signs up/logs in with a persistent account, or a
/// clinician signs in with the existing clinician auth.
struct AccountChooserView: View {
    let onChoosePatient: () -> Void
    let onChooseClinic: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Text("POSTUREPULSE")
                .font(NeonTypo.heading)
                .tracking(1)
                .foregroundColor(NeonTheme.textPrimary)
            VStack(spacing: 16) {
                accountButton(title: "Patient", icon: "person.fill", action: onChoosePatient)
                accountButton(title: "Clinic", icon: "stethoscope", action: onChooseClinic)
            }
            .padding(.horizontal, 28)
            Spacer()
            Text("Results are camera-based estimates that a clinician reviews.")
                .font(.footnote)
                .foregroundColor(NeonTheme.textDim)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)
                .padding(.bottom, 18)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(NeonTheme.bgDeep.ignoresSafeArea())
    }

    private func accountButton(title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.title3.weight(.semibold))
                .foregroundColor(NeonTheme.textPrimary)
                .frame(maxWidth: .infinity, minHeight: 56)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NeonTheme.violet.opacity(0.5), lineWidth: 1))
        }
        .accessibilityHint("Starts \(title.lowercased()) sign-in")
    }
}
