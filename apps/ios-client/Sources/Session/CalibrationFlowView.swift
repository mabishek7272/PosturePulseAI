import SwiftUI

/// Guides the user through camera setup before a session moves from Setup to
/// Observing (TRD 2.5 - the FSM requires an explicit "calibrated and
/// consented" step). This phase does no automated view/quality validation
/// here - see docs/coordinate-frames.md "Explicitly deferred" for the AR
/// anchor / calibration work this will eventually gate on.
struct CalibrationFlowView: View {
    let sessionId: String
    let onCalibrated: () -> Void

    @State private var isCalibrating = false
    @State private var errorMessage: String?

    private let client = SessionsClient()

    var body: some View {
        VStack(spacing: 20) {
            Text("Position your device so your full body is visible")
                .font(.title3)
                .multilineTextAlignment(.center)
                .padding()

            Text("Estimated measurements only - not a diagnosis. See in-app privacy and consent details.")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            if let errorMessage {
                Text(errorMessage).foregroundColor(.red)
            }

            Button {
                calibrate()
            } label: {
                if isCalibrating {
                    ProgressView()
                } else {
                    Text("I'm ready").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isCalibrating)
            .padding(.horizontal)
        }
    }

    private func calibrate() {
        isCalibrating = true
        Task {
            defer { isCalibrating = false }
            do {
                _ = try await client.calibrate(sessionId: sessionId)
                onCalibrated()
            } catch {
                errorMessage = "Could not start the session: \(error.localizedDescription)"
            }
        }
    }
}
