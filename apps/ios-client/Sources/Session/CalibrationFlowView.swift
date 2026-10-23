import SwiftUI

/// Guides the user through camera setup before a session moves from Setup to
/// Observing (TRD 2.5 - the FSM requires an explicit "calibrated and
/// consented" step). The per-step checks (level, framing, view, stillness)
/// run on device during the battery (GuidanceEngine) and again on the server.
struct CalibrationFlowView: View {
    let credentials: SessionCredentials
    var mode: SessionMode = .patient
    let onCalibrated: () -> Void

    @State private var isCalibrating = false
    @State private var errorMessage: String?

    private let client = SessionsClient()

    private var checklist: [(icon: String, title: String, detail: String)] {
        [
            ("iphone", "Stand the phone upright and level", "On a tripod or against something stable at waist height, back camera facing where you will stand."),
            ("figure.stand", "Step back about 3 metres", "Your whole body, head to feet, should fit in the frame."),
            ("lightbulb", "Light from the front", "Avoid a bright window behind you."),
            ("tshirt", "Wear fitted clothing", "Loose clothes hide the joints the camera looks for."),
            mode == .patient
                ? ("speaker.wave.2", "Listen for the voice", "The phone speaks each instruction and starts recording on its own when you are in place.")
                : ("video", "Recording starts on its own", "Each step records once the person is in frame, the phone is level and they are still."),
        ]
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Before you start", color: Theme.brand)
                    Text("Set up your space")
                        .font(Typo.hero)
                        .foregroundColor(Theme.ink)
                }
                .padding(.top, 16)

                VStack(spacing: 0) {
                    ForEach(Array(checklist.enumerated()), id: \.offset) { index, item in
                        HStack(alignment: .top, spacing: 14) {
                            Image(systemName: item.icon)
                                .font(.title3)
                                .foregroundColor(Theme.brand)
                                .frame(width: 40, height: 40)
                                .background(Circle().fill(Theme.brandTint))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(item.title).font(.headline).foregroundColor(Theme.ink)
                                Text(item.detail).font(.footnote).foregroundColor(Theme.inkSoft)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 12)
                        if index < checklist.count - 1 {
                            Rectangle().fill(Theme.hairline).frame(height: 1).padding(.leading, 54)
                        }
                    }
                }
                .card()

                Text("You can stop at any time with the red Stop button. The results are camera-based estimates that your clinician reviews.")
                    .font(.footnote)
                    .foregroundColor(Theme.inkSoft)

                if let errorMessage {
                    Text(errorMessage).font(.footnote).foregroundColor(Theme.ink)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.draftTint))
                }

                Button {
                    calibrate()
                } label: {
                    if isCalibrating {
                        ProgressView().tint(.white)
                    } else {
                        Text("I'm ready")
                    }
                }
                .buttonStyle(.primary)
                .disabled(isCalibrating)
            }
            .padding(.horizontal, Theme.gutter)
            .readableColumn()
            .padding(.bottom, 24)
        }
        .paperBackground()
    }

    private func calibrate() {
        isCalibrating = true
        Task {
            defer { isCalibrating = false }
            do {
                _ = try await client.calibrate(credentials: credentials)
                onCalibrated()
            } catch {
                errorMessage = "Could not start the session. Check your connection and try again."
            }
        }
    }
}
