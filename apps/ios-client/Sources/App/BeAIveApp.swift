import SwiftUI

@main
struct BeAIveApp: App {
    var body: some Scene {
        WindowGroup {
            content
                .tint(Theme.brand)
                .preferredColorScheme(.light)
        }
    }

    @ViewBuilder
    private var content: some View {
        #if DEBUG
        if let preview = DesignPreview.fromLaunchArguments() {
            preview.view
        } else {
            RootView()
        }
        #else
        RootView()
        #endif
    }
}

#if DEBUG
/// Debug-only design previews with sample data: launch with
/// `-designPreview report|report-movement|capture|reps|setup|patients|results|splash|mode-chooser|account-chooser`.
private enum DesignPreview: String {
    case report, capture, reps, setup, patients, results
    case reportMovement = "report-movement"
    case splash
    case modeChooser = "mode-chooser"
    case accountChooser = "account-chooser"

    static func fromLaunchArguments() -> DesignPreview? {
        UserDefaults.standard.string(forKey: "designPreview").flatMap(DesignPreview.init(rawValue:))
    }

    @ViewBuilder
    var view: some View {
        switch self {
        case .report:
            AssessmentReportView(report: .sample)
        case .reportMovement:
            AssessmentReportView(report: .sample.withoutFirstSection)
        case .capture:
            GuidedCaptureView(
                steps: ["Front view", "Left side", "Right side", "Back view"],
                state: .init(
                    stepIndex: 0,
                    instruction: "Front view",
                    detail: "Face the camera. Stand tall and relaxed, feet hip-width apart, arms by your sides. Hold still.",
                    toast: nil,
                    holdProgress: 0.62,
                    repCount: nil,
                    repTarget: nil,
                    recordingPrompt: "Recording - hold still",
                    canStart: false
                ),
                stage: { SilhouetteStage() },
                stop: { StopControlPreview() },
                onStart: {}
            )
        case .reps:
            GuidedCaptureView(
                steps: ["Front", "Side", "Squat", "Sit–stand", "Shoulder"],
                state: .init(
                    stepIndex: 2,
                    instruction: "Squat, then stand tall",
                    detail: "Turn side-on. Lower as far as is comfortable, at your own pace.",
                    toast: CaptureToast(icon: "iphone.gen3", text: "Level the phone"),
                    holdProgress: nil,
                    repCount: 3,
                    repTarget: 5,
                    recordingPrompt: nil,
                    canStart: true
                ),
                stage: { SilhouetteStage() },
                stop: { StopControlPreview() },
                onStart: {}
            )
        case .patients:
            PatientPickerView(clinicianToken: "preview", onPicked: { _ in }, onBack: {})
        case .results:
            ResultsView(onBack: {})
        case .setup:
            CalibrationFlowView(credentials: SessionCredentials(sessionId: "preview", token: "preview")) {}
        case .splash:
            SplashView(onFinished: {})
        case .modeChooser:
            ModeChooserView(onChoose: { _ in }, onViewResults: {})
        case .accountChooser:
            AccountChooserView(onChoosePatient: {}, onChooseClinic: {})
        }
    }
}
#endif
