import SwiftUI

/// Mode -> (clinic: clinician sign-in -> patient register) -> consent ->
/// battery + session -> setup -> battery -> done (patient: report access;
/// clinic: link the visit to the patient). Patient mode uses this device's
/// pseudonymous id and its saved consent. Clinic mode runs on a shared device,
/// so every visit gets a fresh pseudonymous id and its own consent
/// (docs/adr/012).
struct RootView: View {
    private enum Step {
        case splash
        case chooseAccount
        case patientAuth
        case clinicianSignIn
        case pickPatient
        case consent
        case preparing
        case setup(SessionCredentials, AssessmentBattery)
        case battery(SessionCredentials, AssessmentBattery)
        case done(SessionCredentials, completed: Bool)
        case results
    }

    @State private var step: Step = .splash
    @State private var mode: SessionMode = .patient
    @State private var clinicianToken: String?
    @State private var patient: PatientSummary?
    @State private var visitSubjectId = UUID().uuidString.lowercased()
    @State private var visitConsentRecordId: String?
    @State private var patientToken: String?
    private let identity: SubjectIdentityStore
    private let patientSession = PatientSessionStore()

    init(identity: SubjectIdentityStore = SubjectIdentityStore()) {
        self.identity = identity
        _patientToken = State(initialValue: PatientSessionStore().token)
    }

    private var subjectPseudoId: String {
        mode == .clinic ? visitSubjectId : identity.subjectPseudoId()
    }

    private var consentRecordId: String? {
        mode == .clinic ? visitConsentRecordId : identity.consentRecordId
    }

    var body: some View {
        switch step {
        case .splash:
            SplashView(onFinished: { step = .chooseAccount })
        case .chooseAccount:
            AccountChooserView(
                onChoosePatient: {
                    mode = .patient
                    if patientToken != nil {
                        // Returning patient: skip straight into the existing flow this
                        // part doesn't yet change (Part 2 wires the account in further).
                        step = afterPatient
                    } else {
                        step = .patientAuth
                    }
                },
                onChooseClinic: {
                    mode = .clinic
                    visitSubjectId = UUID().uuidString.lowercased()
                    visitConsentRecordId = nil
                    patient = nil
                    step = clinicianToken == nil ? .clinicianSignIn : .pickPatient
                }
            )
        case .patientAuth:
            PatientAuthView(
                onSignedIn: { token in
                    patientToken = token
                    patientSession.save(token: token)
                    step = afterPatient
                },
                onBack: { step = .chooseAccount }
            )
        case .clinicianSignIn:
            ClinicianSignInView(onSignedIn: { token in
                clinicianToken = token
                step = .pickPatient
            }, onBack: { step = .chooseAccount })
        case .pickPatient:
            if let clinicianToken {
                PatientPickerView(clinicianToken: clinicianToken, onPicked: { picked in
                    patient = picked
                    step = afterPatient
                }, onBack: { step = .chooseAccount })
            } else {
                ClinicianSignInView(onSignedIn: { token in clinicianToken = token }, onBack: { step = .chooseAccount })
            }
        case .consent:
            ConsentView(subjectPseudoId: subjectPseudoId) { consentRecordId in
                if mode == .clinic {
                    visitConsentRecordId = consentRecordId
                } else {
                    identity.saveConsentRecordId(consentRecordId)
                }
                step = .preparing
            }
        case .preparing:
            if let consentRecordId {
                SessionPreparationView(
                    mode: mode,
                    subjectPseudoId: subjectPseudoId,
                    consentRecordId: consentRecordId,
                    onReady: { credentials, battery in step = .setup(credentials, battery) },
                    onConsentRejected: {
                        if mode == .clinic { visitConsentRecordId = nil } else { identity.clearConsentRecordId() }
                        step = .consent
                    },
                    onBack: { step = .chooseAccount }
                )
            } else {
                ConsentView(subjectPseudoId: subjectPseudoId) { id in
                    if mode == .clinic { visitConsentRecordId = id } else { identity.saveConsentRecordId(id) }
                    step = .preparing
                }
            }
        case .setup(let credentials, let battery):
            CalibrationFlowView(credentials: credentials, mode: mode) {
                step = .battery(credentials, battery)
            }
        case .battery(let credentials, let battery):
            BatteryView(
                battery: battery,
                mode: mode,
                credentials: credentials,
                onFinished: { step = .done(credentials, completed: true) },
                onExit: { step = .done(credentials, completed: false) }
            )
            .id(credentials.sessionId)
        case .done(let credentials, let completed):
            BatteryDoneView(
                context: doneContext(credentials),
                completed: completed,
                onViewResults: { step = .results },
                onDone: { step = .chooseAccount }
            )
        case .results:
            ResultsView(onBack: { step = .chooseAccount })
        }
    }

    private var afterPatient: Step {
        consentRecordId == nil ? .consent : .preparing
    }

    private func doneContext(_ credentials: SessionCredentials) -> BatteryDoneView.Context {
        if mode == .clinic, let clinicianToken, let patient {
            return .clinic(clinicianToken: clinicianToken, patientId: patient.id, subjectPseudoId: visitSubjectId)
        }
        return .patient(credentials)
    }
}

/// Fetches the battery and opens the session it runs in.
private struct SessionPreparationView: View {
    let mode: SessionMode
    let subjectPseudoId: String
    let consentRecordId: String
    let onReady: (SessionCredentials, AssessmentBattery) -> Void
    let onConsentRejected: () -> Void
    let onBack: () -> Void

    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Eyebrow("Assessment", color: Theme.brand)
            Text("Getting ready")
                .font(Typo.hero)
                .foregroundColor(Theme.ink)
            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundColor(Theme.ink)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Theme.draftTint))
                Button("Try again") { Task { await prepare() } }.buttonStyle(.primary)
                Button("Back", action: onBack)
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
            } else {
                ProgressView()
            }
            Spacer()
        }
        .padding(.horizontal, Theme.gutter)
        .padding(.top, 24)
        .readableColumn()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .paperBackground()
        .task { await prepare() }
    }

    private func prepare() async {
        errorMessage = nil
        do {
            let battery = try await BatteryClient().fetch()
            guard !battery.steps(for: mode).filter(\.isRecordableHold).isEmpty else {
                errorMessage = "There are no steps to record in this mode yet."
                return
            }
            let response = try await SessionsClient().create(
                .init(
                    subjectPseudoId: subjectPseudoId,
                    protocolId: "assessment-battery",
                    protocolVersion: battery.version,
                    deploymentContext: mode == .clinic ? "clinic_supervised" : "home_rehab",
                    consentRecordId: consentRecordId,
                    retentionPolicy: .init(
                        rawVideo: .init(optIn: false, retentionDays: nil),
                        derivedEvents: .init(retentionDays: 30)
                    )
                )
            )
            onReady(response.credentials, battery)
        } catch SessionsClientError.consentRejected {
            onConsentRejected()
        } catch {
            errorMessage = "Could not start a session. Check your connection and try again."
        }
    }
}
