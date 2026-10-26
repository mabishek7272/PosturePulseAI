import SwiftUI

/// Patient sign-up/sign-in (ADR-019). Mirrors ClinicianSignInView's structure.
struct PatientAuthView: View {
    let onSignedIn: (_ token: String) -> Void
    let onBack: () -> Void

    private enum Mode { case signUp, signIn }

    @State private var mode: Mode = .signUp
    @State private var email = ""
    @State private var password = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private let client = PatientAuthClient()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Button(action: onBack) {
                    Label("Back", systemImage: "chevron.left").font(.subheadline.weight(.semibold))
                }
                .foregroundColor(NeonTheme.textPrimary)
                .padding(.top, 8)

                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Patient", color: NeonTheme.violet)
                    Text(mode == .signUp ? "Create your account" : "Welcome back")
                        .font(NeonTypo.heading)
                        .foregroundColor(NeonTheme.textPrimary)
                }

                Picker("Mode", selection: $mode) {
                    Text("Sign up").tag(Mode.signUp)
                    Text("Sign in").tag(Mode.signIn)
                }
                .pickerStyle(.segmented)

                VStack(spacing: 12) {
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Divider()
                    SecureField("Password (12+ characters)", text: $password)
                        .textContentType(mode == .signUp ? .newPassword : .password)
                        .onSubmit(submit)
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 14).fill(Color.white.opacity(0.06)))

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundColor(NeonTheme.textPrimary)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12).fill(NeonTheme.caution.opacity(0.25)))
                }

                Button(action: submit) {
                    if isSubmitting { ProgressView().tint(.white) } else { Text(mode == .signUp ? "Create account" : "Sign in") }
                }
                .buttonStyle(.primary)
                .disabled(isSubmitting || email.isEmpty || password.isEmpty)
            }
            .padding(.horizontal, Theme.gutter)
            .padding(.bottom, 28)
        }
        .background(NeonTheme.bgDeep.ignoresSafeArea())
    }

    private func submit() {
        guard !email.isEmpty, !password.isEmpty, !isSubmitting else { return }
        isSubmitting = true
        errorMessage = nil
        Task {
            defer { isSubmitting = false }
            do {
                let token = mode == .signUp
                    ? try await client.signUp(email: email, password: password)
                    : try await client.signIn(email: email, password: password)
                password = ""
                onSignedIn(token)
            } catch PatientAuthError.invalidCredentials {
                errorMessage = "Email or password is not correct."
            } catch PatientAuthError.emailTaken {
                errorMessage = "An account with that email already exists. Try signing in instead."
            } catch PatientAuthError.invalidInput {
                errorMessage = "Check your email and make sure the password is at least 12 characters."
            } catch {
                errorMessage = "Could not reach the server. Check your connection and try again."
            }
        }
    }
}
