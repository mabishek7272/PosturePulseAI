import SwiftUI

/// Runs the battery on screen: guided capture per step, then the step's
/// quality outcome with Redo. The local-first SymptomStopButton is on screen
/// in every phase until the battery has stopped or finished.
struct BatteryView: View {
    let credentials: SessionCredentials
    let onFinished: () -> Void
    /// Leaving after a stop, a refusal or a camera problem.
    let onExit: () -> Void

    @StateObject private var runner: BatteryRunner
    @State private var started = false

    init(battery: AssessmentBattery, mode: SessionMode, credentials: SessionCredentials,
         onFinished: @escaping () -> Void, onExit: @escaping () -> Void) {
        self.credentials = credentials
        self.onFinished = onFinished
        self.onExit = onExit
        // Built once per view identity (StateObject's autoclosure), so the
        // preview always shows the recorder the runner records with.
        _runner = StateObject(wrappedValue: BatteryRunner(
            battery: battery,
            mode: mode,
            credentials: credentials,
            recorder: ClipRecorder(),
            queue: ClipUploadQueue(
                directory: (try? ClipUploadQueue.defaultDirectory())
                    ?? FileManager.default.temporaryDirectory.appendingPathComponent("ClipUploads", isDirectory: true),
                uploader: ClipUploadClient()
            ),
            statusClient: StepStatusClient(),
            speaker: mode == .patient ? SpeechInstructionSpeaker() : nil
        ))
    }

    private var recorder: ClipRecorder? { runner.recorder as? ClipRecorder }

    var body: some View {
        content
            .task {
                guard !started else { return }
                started = true
                runner.onFinished = onFinished
                runner.start()
                // Send any clip a previous run could not deliver.
                await runner.drainPendingUploads()
            }
            .onDisappear { runner.recorder.halt() }
    }

    private var stepTitles: [String] { runner.steps.map { $0.title } }

    @ViewBuilder
    private var content: some View {
        switch runner.phase {
        case .guiding, .recording:
            capture
        case .uploading:
            statusScreen(eyebrow: stepEyebrow, title: "Sending the recording", detail: "This takes a moment.", busy: true)
        case .processing:
            statusScreen(eyebrow: stepEyebrow, title: "Checking the recording", detail: "The clinic server is checking that this step can be measured.", busy: true)
        case .result(let outcome):
            OutcomeView(outcome: outcome, eyebrow: stepEyebrow, isLastStep: runner.stepIndex + 1 >= runner.steps.count,
                        onRedo: runner.redo, onNext: runner.next) { stopButton }
        case .stopped:
            message(title: "Assessment stopped", detail: "Rest, and seek medical help if you need it. Your clinic is being told that you stopped.", button: "Done")
        case .refused:
            message(title: "Recording not accepted", detail: "The clinic server is not accepting recordings for this session right now. Please contact your clinic.", button: "Done")
        case .cameraUnavailable:
            message(title: "Camera not available", detail: "Allow camera access for PosturePulse AI in Settings, then start again.", button: "Done")
        case .finished:
            statusScreen(eyebrow: "Assessment", title: "All steps recorded", detail: "", busy: true)
        }
    }

    private var stepEyebrow: String {
        guard let step = runner.currentStep else { return "Assessment" }
        return "Step \(runner.stepIndex + 1) of \(runner.steps.count) · \(step.title)"
    }

    private var stopButton: some View {
        SymptomStopButton(credentials: credentials) {
            runner.haltLocally()
        }
    }

    private var capture: some View {
        let step = runner.currentStep
        let recording = runner.phase == .recording
        return GuidedCaptureView(
            steps: stepTitles,
            state: .init(
                stepIndex: runner.stepIndex,
                instruction: step?.title ?? "",
                detail: step?.instruction ?? "",
                tiltDegrees: runner.guidance?.rollDegrees,
                isLevel: runner.guidance?.isLevel,
                holdProgress: recording ? runner.holdProgress : nil,
                repCount: nil,
                repTarget: nil,
                qualityPrompt: recording ? "Recording - hold still" : (runner.prompt ?? (runner.guidance == nil ? nil : "Hold still - recording starts in a moment"))
            ),
            stage: {
                ZStack {
                    if let recorder { CameraPreviewView(session: recorder.session) }
                    SkeletonOverlay(pose: runner.pose, imageSize: runner.imageSize)
                }
            },
            stop: { stopButton }
        )
    }

    private func statusScreen(eyebrow: String, title: String, detail: String, busy: Bool) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Eyebrow(eyebrow, color: Theme.brand)
            Text(title).font(Typo.hero).foregroundColor(Theme.ink)
            if !detail.isEmpty {
                Text(detail).font(.callout).foregroundColor(Theme.inkSoft)
            }
            if busy { ProgressView().padding(.top, 8) }
            Spacer()
            if runner.phase != .finished { stopButton }
        }
        .padding(.horizontal, Theme.gutter)
        .padding(.vertical, 24)
        .readableColumn()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .paperBackground()
    }

    private func message(title: String, detail: String, button: String) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Eyebrow("Assessment", color: Theme.brand)
            Text(title).font(Typo.hero).foregroundColor(Theme.ink)
            Text(detail).font(.callout).foregroundColor(Theme.inkSoft).fixedSize(horizontal: false, vertical: true)
            Spacer()
            if runner.phase != .stopped { stopButton }
            Button(button, action: onExit).buttonStyle(.primary)
        }
        .padding(.horizontal, Theme.gutter)
        .padding(.vertical, 24)
        .readableColumn()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .paperBackground()
    }
}

/// A step's quality outcome. Never shows a measured value - only whether the
/// recording can be measured and, if not, why in plain words.
private struct OutcomeView<Stop: View>: View {
    let outcome: BatteryRunner.StepOutcome
    let eyebrow: String
    let isLastStep: Bool
    let onRedo: () -> Void
    let onNext: () -> Void
    @ViewBuilder let stop: () -> Stop

    private var nextTitle: String { isLastStep ? "Finish" : "Next step" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Eyebrow(eyebrow, color: Theme.brand)
                Text(title).font(Typo.hero).foregroundColor(Theme.ink).fixedSize(horizontal: false, vertical: true)
                Text(detail).font(.callout).foregroundColor(Theme.inkSoft).fixedSize(horizontal: false, vertical: true)

                if case .redo(let reasons) = outcome, !reasons.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(reasons, id: \.self) { reason in
                            Label(reason, systemImage: "viewfinder")
                                .font(.subheadline)
                                .foregroundColor(Theme.ink)
                        }
                    }
                    .card()
                }

                actions
                stop()
            }
            .padding(.horizontal, Theme.gutter)
            .padding(.vertical, 24)
            .readableColumn()
        }
        .paperBackground()
    }

    private var title: String {
        switch outcome {
        case .looksGood: return "Looks good"
        case .redo: return "Please redo this step"
        case .notAnalysed: return "This recording could not be checked"
        case .stillProcessing: return "Still being checked"
        case .notSent: return "Saved on this phone"
        case .notRecorded: return "The recording did not work"
        }
    }

    private var detail: String {
        switch outcome {
        case .looksGood: return "This step can be measured. Your clinician reviews the results."
        case .redo: return "The recording cannot be measured because:"
        case .notAnalysed: return "Please record this step again."
        case .stillProcessing: return "You can go on. Your clinician will see this step once it has been checked."
        case .notSent: return "The clinic server could not be reached. The recording stays on this phone and is sent when the connection is back."
        case .notRecorded: return "Please try this step again."
        }
    }

    @ViewBuilder
    private var actions: some View {
        switch outcome {
        case .looksGood, .stillProcessing, .notSent:
            Button(nextTitle, action: onNext).buttonStyle(.primary)
        case .redo, .notAnalysed, .notRecorded:
            Button("Redo this step", action: onRedo).buttonStyle(.primary)
            Button(isLastStep ? "Finish without redoing" : "Skip for now", action: onNext)
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity)
        }
    }
}
