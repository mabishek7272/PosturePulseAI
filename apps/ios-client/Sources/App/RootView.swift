import SwiftUI

/// Consent -> pick a draft protocol -> calibrate -> live session. The subject
/// id is the device's pseudonymous UUID and the consent record is the one the
/// subject granted in ConsentView (docs/adr/012).
struct RootView: View {
    private enum Step {
        case consent
        case selectProtocol
        case calibrate(SessionCredentials)
        case live(SessionCredentials)
    }

    @State private var step: Step
    @State private var errorMessage: String?
    private let identity: SubjectIdentityStore
    private let sessionsClient = SessionsClient()

    init(identity: SubjectIdentityStore = SubjectIdentityStore()) {
        self.identity = identity
        _step = State(initialValue: identity.consentRecordId == nil ? .consent : .selectProtocol)
    }

    var body: some View {
        switch step {
        case .consent:
            ConsentView(subjectPseudoId: identity.subjectPseudoId()) { consentRecordId in
                identity.saveConsentRecordId(consentRecordId)
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

    private func createSession(for proto: ProtocolSummary) {
        guard let consentRecordId = identity.consentRecordId else {
            step = .consent
            return
        }
        errorMessage = nil
        Task {
            do {
                let response = try await sessionsClient.create(
                    .init(
                        subjectPseudoId: identity.subjectPseudoId(),
                        protocolId: proto.protocolKey,
                        protocolVersion: proto.version,
                        deploymentContext: "clinic_supervised",
                        consentRecordId: consentRecordId,
                        retentionPolicy: .init(
                            rawVideo: .init(optIn: false, retentionDays: nil),
                            derivedEvents: .init(retentionDays: 30)
                        )
                    )
                )
                step = .calibrate(response.credentials)
            } catch SessionsClientError.consentRejected {
                identity.clearConsentRecordId()
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
