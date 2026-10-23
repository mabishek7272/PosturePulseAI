import SwiftUI

/// After the battery (finished or stopped).
/// Patient mode: get and keep the report-access token, then tell the person
/// their clinician reviews the results first.
/// Clinic mode: link this visit's pseudonymous subject to the register patient.
struct BatteryDoneView: View {
    enum Context {
        case patient(SessionCredentials)
        case clinic(clinicianToken: String, patientId: String, subjectPseudoId: String)
    }

    let context: Context
    let completed: Bool
    let onViewResults: () -> Void
    let onDone: () -> Void

    @State private var isWorking = false
    @State private var done = false
    @State private var failed = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                BrandHeader().padding(.top, 4)
                Eyebrow("Assessment", color: Theme.brand)
                Text(title)
                    .font(Typo.hero)
                    .foregroundColor(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(detail)
                    .font(.callout)
                    .foregroundColor(Theme.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)

                if isWorking {
                    ProgressView()
                } else if failed {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(failureText).font(.footnote).foregroundColor(Theme.ink)
                        Button("Try again") { Task { await run() } }
                            .font(.subheadline.weight(.semibold))
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Theme.draftTint))
                }

                if case .patient = context, done {
                    Button("Check for results", action: onViewResults).buttonStyle(.primary)
                }
                Button(doneTitle, action: onDone)
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .padding(.horizontal, Theme.gutter)
            .readableColumn()
            .padding(.bottom, 28)
        }
        .paperBackground()
        .task { await run() }
    }

    private var title: String {
        switch context {
        case .patient: return completed ? "Thank you" : "Assessment stopped"
        case .clinic: return completed ? "Assessment recorded" : "Assessment stopped"
        }
    }

    private var detail: String {
        switch context {
        case .patient:
            return "Your clinician will review your results. You can see them here once they have been released."
        case .clinic:
            return "Build and review the draft report in the clinician web app. Results reach the patient only after sign-off."
        }
    }

    private var failureText: String {
        switch context {
        case .patient: return "Could not reach your clinic's server to set up access to your results."
        case .clinic: return "Could not link this session to the patient record."
        }
    }

    private var doneTitle: String {
        switch context {
        case .patient: return "Done"
        case .clinic: return "Start a new session"
        }
    }

    private func run() async {
        guard !done, !isWorking else { return }
        isWorking = true
        failed = false
        defer { isWorking = false }
        do {
            switch context {
            case .patient(let credentials):
                let token = try await ReportAccessClient().requestAccess(credentials: credentials)
                ReportAccessStore().save(sessionId: credentials.sessionId, token: token)
            case .clinic(let clinicianToken, let patientId, let subjectPseudoId):
                try await PatientsClient(clinicianToken: clinicianToken).link(patientId: patientId, subjectPseudoId: subjectPseudoId)
            }
            done = true
        } catch {
            failed = true
        }
    }
}
