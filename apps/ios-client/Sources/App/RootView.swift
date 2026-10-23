import SwiftUI

/// Mode -> (clinic: clinician sign-in) -> consent -> protocol -> calibrate ->
/// live session. Patient mode uses this device's pseudonymous id and its saved
/// consent. Clinic mode runs on a shared device, so every visit gets a fresh
/// pseudonymous id and its own consent (docs/adr/012).
struct RootView: View {
    private enum Step {
        case chooseMode
        case clinicianSignIn
        case consent
        case selectProtocol
        case calibrate(SessionCredentials)
        case live(SessionCredentials)
    }

    @State private var step: Step = .chooseMode
    @State private var errorMessage: String?
    @State private var mode: SessionMode = .patient
    @State private var clinicianToken: String?
    @State private var visitSubjectId = UUID().uuidString.lowercased()
    @State private var visitConsentRecordId: String?
    private let identity: SubjectIdentityStore
    private let sessionsClient = SessionsClient()

    init(identity: SubjectIdentityStore = SubjectIdentityStore()) {
        self.identity = identity
    }

    private var subjectPseudoId: String {
        mode == .clinic ? visitSubjectId : identity.subjectPseudoId()
    }

    private var consentRecordId: String? {
        mode == .clinic ? visitConsentRecordId : identity.consentRecordId
    }

    var body: some View {
        switch step {
        case .chooseMode:
            ModeChooserView { chosen in
                mode = chosen
                visitSubjectId = UUID().uuidString.lowercased()
                visitConsentRecordId = nil
                step = chosen.requiresClinicianSignIn ? .clinicianSignIn : afterSignIn
            }
        case .clinicianSignIn:
            ClinicianSignInView(onSignedIn: { token in
                clinicianToken = token
                step = afterSignIn
            }, onBack: { step = .chooseMode })
        case .consent:
            ConsentView(subjectPseudoId: subjectPseudoId) { consentRecordId in
                if mode == .clinic {
                    visitConsentRecordId = consentRecordId
                } else {
                    identity.saveConsentRecordId(consentRecordId)
                }
                step = .selectProtocol
            }
        case .selectProtocol:
            ProtocolSelectionView { proto in
                createSession(for: proto)
            }
            .overlay(alignment: .bottom) {
                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundColor(Theme.ink)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.draftTint))
                        .padding(Theme.gutter)
                }
            }
        case .calibrate(let credentials):
            CalibrationFlowView(credentials: credentials) {
                step = .live(credentials)
            }
        case .live(let credentials):
            LiveSessionView(credentials: credentials)
        }
    }

    private var afterSignIn: Step {
        consentRecordId == nil ? .consent : .selectProtocol
    }

    private func createSession(for proto: ProtocolSummary) {
        guard let consentRecordId else {
            step = .consent
            return
        }
        errorMessage = nil
        Task {
            do {
                let response = try await sessionsClient.create(
                    .init(
                        subjectPseudoId: subjectPseudoId,
                        protocolId: proto.protocolKey,
                        protocolVersion: proto.version,
                        deploymentContext: mode == .clinic ? "clinic_supervised" : "home_rehab",
                        consentRecordId: consentRecordId,
                        retentionPolicy: .init(
                            rawVideo: .init(optIn: false, retentionDays: nil),
                            derivedEvents: .init(retentionDays: 30)
                        )
                    )
                )
                step = .calibrate(response.credentials)
            } catch SessionsClientError.consentRejected {
                if mode == .clinic { visitConsentRecordId = nil } else { identity.clearConsentRecordId() }
                step = .consent
            } catch {
                errorMessage = "Could not start a session. Check your connection and try again."
            }
        }
    }
}

private struct LiveSessionView: View {
    @StateObject private var viewModel: SessionViewModel

    init(credentials: SessionCredentials) {
        _viewModel = StateObject(wrappedValue: SessionViewModel(credentials: credentials))
    }

    var body: some View {
        ZStack {
            PoseOverlayView(frame: viewModel.latestFrame, qualityGateFlag: viewModel.latestQualityGateFlag)

            VStack {
                Spacer()
                SymptomStopButton(credentials: viewModel.credentials) {
                    viewModel.haltLocally()
                }
                .padding()
            }
        }
        .task {
            try? viewModel.start()
        }
        .onDisappear {
            viewModel.stop()
        }
    }
}
