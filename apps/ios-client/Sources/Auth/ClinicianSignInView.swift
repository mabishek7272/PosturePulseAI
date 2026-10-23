import SwiftUI

/// Clinic mode sign-in. Accounts are created by the clinic operator
/// (services/backend-api/scripts/seed-clinician.ts); there is no self sign-up.
struct ClinicianSignInView: View {
    let onSignedIn: (_ clinicianToken: String) -> Void
    let onBack: () -> Void

    @State private var username = ""
    @State private var password = ""
    @State private var isSigningIn = false
    @State private var errorMessage: String?

    private let client = ClinicianAuthClient()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Button(action: onBack) {
                    Label("Back", systemImage: "chevron.left").font(.subheadline.weight(.semibold))
                }
                .padding(.top, 8)

                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Clinic mode", color: Theme.brand)
                    Text("Clinician sign-in")
                        .font(Typo.hero)
                        .foregroundColor(Theme.ink)
                }

                VStack(spacing: 12) {
                    TextField("Username", text: $username)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Divider()
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .onSubmit(signIn)
                }
                .card()

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundColor(Theme.ink)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.draftTint))
                }

                Button(action: signIn) {
                    if isSigningIn { ProgressView().tint(.white) } else { Text("Sign in") }
                }
                .buttonStyle(.primary)
                .disabled(isSigningIn || username.isEmpty || password.isEmpty)
            }
            .padding(.horizontal, Theme.gutter)
            .readableColumn()
            .padding(.bottom, 28)
        }
        .paperBackground()
    }

    private func signIn() {
        guard !username.isEmpty, !password.isEmpty, !isSigningIn else { return }
        isSigningIn = true
        errorMessage = nil
        Task {
            defer { isSigningIn = false }
            do {
                let token = try await client.signIn(username: username, password: password)
                password = ""
                onSignedIn(token)
            } catch ClinicianAuthError.invalidCredentials {
                errorMessage = "Username or password is not correct."
            } catch {
                errorMessage = "Could not reach the clinic server. Check your connection and try again."
            }
        }
    }
}
