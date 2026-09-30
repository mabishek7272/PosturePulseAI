import SwiftUI

/// Ties together the P0 scaffolding flow: pick a draft protocol -> calibrate
/// -> live session view with pose overlay + local-first symptom stop.
/// `subjectPseudoId`/`consentRecordId` are placeholders here - a real login/
/// consent flow is out of scope for this phase (docs/consent-and-retention.md).
struct RootView: View {
    private enum Step {
        case selectProtocol
        case calibrate(sessionId: String)
        case live(sessionId: String)
    }

    @State private var step: Step = .selectProtocol
    private let sessionsClient = SessionsClient()

    var body: some View {
        switch step {
        case .selectProtocol:
            ProtocolSelectionView { proto in
                createSession(for: proto)
            }
        case .calibrate(let sessionId):
            CalibrationFlowView(sessionId: sessionId) {
                step = .live(sessionId: sessionId)
            }
        case .live(let sessionId):
            LiveSessionView(sessionId: sessionId)
        }
    }

    private func createSession(for proto: ProtocolSummary) {
        Task {
            do {
                let record = try await sessionsClient.create(
                    .init(
                        subjectPseudoId: "dev-placeholder-subject",
                        protocolId: proto.protocolKey,
                        protocolVersion: proto.version,
                        deploymentContext: "clinic_supervised",
                        consentRecordId: "dev-placeholder-consent",
                        retentionPolicy: .init(
                            rawVideo: .init(optIn: false, retentionDays: nil),
                            derivedEvents: .init(retentionDays: 30)
                        )
                    )
                )
                step = .calibrate(sessionId: record.id)
            } catch {
                // Scaffolding-level error handling only - a real app would
                // surface this to the user with a retry action.
            }
        }
    }
}

private struct LiveSessionView: View {
    @StateObject private var viewModel: SessionViewModel

    init(sessionId: String) {
        _viewModel = StateObject(wrappedValue: SessionViewModel(sessionId: sessionId))
    }

    var body: some View {
        ZStack {
            PoseOverlayView(frame: viewModel.latestFrame, qualityGateFlag: viewModel.latestQualityGateFlag)

            VStack {
                Spacer()
                SymptomStopButton(sessionId: viewModel.sessionId) {
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
