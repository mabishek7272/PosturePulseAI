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
/// `-designPreview report|report-movement|capture|reps|setup`.
private enum DesignPreview: String {
    case report, capture, reps, setup
    case reportMovement = "report-movement"

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
                state: .init(
                    stepIndex: 0,
                    instruction: "Face the camera",
                    detail: "Stand tall, arms relaxed by your sides. Hold still for 5 seconds.",
                    tiltDegrees: 1.2,
                    holdProgress: 0.62,
                    repCount: nil,
                    repTarget: nil,
                    qualityPrompt: "Step back — feet not visible"
                ),
                stage: { SilhouetteStage() },
                stop: { StopControlPreview() }
            )
        case .reps:
            GuidedCaptureView(
                state: .init(
                    stepIndex: 2,
                    instruction: "Squat, then stand tall",
                    detail: "Turn side-on. Lower as far as is comfortable, at your own pace.",
                    tiltDegrees: -5,
                    holdProgress: nil,
                    repCount: 3,
                    repTarget: 5,
                    qualityPrompt: nil
                ),
                stage: { SilhouetteStage() },
                stop: { StopControlPreview() }
            )
        case .setup:
            CalibrationFlowView(sessionId: "preview") {}
        }
    }
}
#endif
