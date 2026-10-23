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
/// `-designPreview report|report-movement|capture|reps|setup|patients|results|splash|mode-chooser`.
private enum DesignPreview: String {
    case report, capture, reps, setup, patients, results
    case reportMovement = "report-movement"
    case splash
    case modeChooser = "mode-chooser"

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
                    tiltDegrees: 1.2,
                    isLevel: true,
                    holdProgress: 0.62,
                    repCount: nil,
                    repTarget: nil,
                    qualityPrompt: "Recording - hold still"
                ),
                stage: { SilhouetteStage() },
                stop: { StopControlPreview() }
            )
        case .reps:
            GuidedCaptureView(
                steps: ["Front", "Side", "Squat", "Sit–stand", "Shoulder"],
                state: .init(
                    stepIndex: 2,
                    instruction: "Squat, then stand tall",
                    detail: "Turn side-on. Lower as far as is comfortable, at your own pace.",
                    tiltDegrees: -5,
                    isLevel: false,
                    holdProgress: nil,
                    repCount: 3,
                    repTarget: 5,
                    qualityPrompt: "Level the phone"
                ),
                stage: { SilhouetteStage() },
                stop: { StopControlPreview() }
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
        }
    }
}
#endif
