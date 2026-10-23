import CoreGraphics
import Foundation

protocol ClipUploadQueueing: AnyObject {
    func enqueue(clipFile: URL, sidecar: ClipCapture, token: String) async throws -> PendingClipUpload
    func send(_ uploadId: String) async -> ClipUploadResult
    func drain() async -> [String: ClipUploadResult]
    func discard(sessionId: String) async
}

extension ClipUploadQueue: ClipUploadQueueing {}

/// Runs the assessment battery for one session (replaces SessionViewModel for
/// assessments, ADR-013): for each step of the mode, on-device guidance ->
/// record a clip with its sidecar -> upload -> poll the step's analysis ->
/// "Looks good" or the reasons with Redo. A symptom stop halts everything
/// locally and synchronously, before any network call.
@MainActor
final class BatteryRunner: ObservableObject {
    enum StepOutcome: Equatable {
        case looksGood
        /// The analysis could not support this step; plain-words reasons.
        case redo(reasons: [String])
        case notAnalysed
        /// Analysis is taking longer than we wait; the person can go on.
        case stillProcessing
        /// The server could not be reached; the clip stays queued on the phone.
        case notSent
        case notRecorded
    }

    enum Phase: Equatable {
        case guiding
        case recording
        case uploading
        case processing
        case result(StepOutcome)
        /// Symptom stop - the battery does not continue.
        case stopped
        /// The server refused the clip (e.g. the session is paused for review).
        case refused
        case cameraUnavailable
        case finished
    }

    let steps: [AssessmentBattery.Step]
    let mode: SessionMode
    let credentials: SessionCredentials

    @Published private(set) var phase: Phase = .guiding
    @Published private(set) var stepIndex = 0
    @Published private(set) var guidance: GuidanceStatus?
    @Published private(set) var prompt: String?
    @Published private(set) var holdProgress: Double = 0

    var onFinished: (() -> Void)?
    var onStopped: (() -> Void)?

    /// The step's record/upload/poll work; exposed for tests.
    private(set) var work: Task<Void, Never>?
    private(set) var cleanup: Task<Void, Never>?

    private let recorder: ClipRecording
    private let queue: ClipUploadQueueing
    private let statusClient: StepStatusFetching
    private let speaker: InstructionSpeaking?
    private let device: DeviceInfo
    private let pollInterval: TimeInterval
    private let maxPolls: Int
    private let uploadAttempts: Int
    private let sleep: (TimeInterval) async -> Void
    private let makeClipId: () -> String
    private var engine: GuidanceEngine?
    private var halted = false
    private var lastSpoken: (issue: GuidanceIssue, time: TimeInterval)?

    init(
        battery: AssessmentBattery,
        mode: SessionMode,
        credentials: SessionCredentials,
        recorder: ClipRecording,
        queue: ClipUploadQueueing,
        statusClient: StepStatusFetching,
        speaker: InstructionSpeaking?,
        device: DeviceInfo = .current,
        pollInterval: TimeInterval = 2,
        maxPolls: Int = 60,
        uploadAttempts: Int = 3,
        sleep: @escaping (TimeInterval) async -> Void = { try? await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) },
        makeClipId: @escaping () -> String = { UUID().uuidString.lowercased() }
    ) {
        self.steps = battery.steps(for: mode).filter(\.isRecordableHold)
        self.mode = mode
        self.credentials = credentials
        self.recorder = recorder
        self.queue = queue
        self.statusClient = statusClient
        self.speaker = speaker
        self.device = device
        self.pollInterval = pollInterval
        self.maxPolls = maxPolls
        self.uploadAttempts = uploadAttempts
        self.sleep = sleep
        self.makeClipId = makeClipId
    }

    var currentStep: AssessmentBattery.Step? { steps.indices.contains(stepIndex) ? steps[stepIndex] : nil }

    func start() {
        recorder.onGuidanceSample = { [weak self] sample in self?.handle(sample) }
        recorder.onRecordingProgress = { [weak self] progress in self?.holdProgress = progress }
        do {
            try recorder.startPreview()
        } catch {
            phase = .cameraUnavailable
            return
        }
        guard !steps.isEmpty else {
            finish()
            return
        }
        beginStep(0)
    }

    private func beginStep(_ index: Int) {
        guard !halted, let step = steps.indices.contains(index) ? steps[index] : nil else { return }
        stepIndex = index
        engine = GuidanceEngine(view: step.view, levelToleranceDegrees: step.levelToleranceDegrees, imageSize: recorder.imageSize)
        guidance = nil
        prompt = nil
        holdProgress = 0
        lastSpoken = nil
        phase = .guiding
        if mode == .patient { speaker?.speak(step.instruction) }
    }

    func handle(_ sample: GuidanceSample) {
        guard phase == .guiding, !halted, let engine, let step = currentStep else { return }
        let status = engine.update(sample)
        guidance = status
        let issue = status.issues.first
        prompt = issue?.prompt(for: step.view)
        // Patient mode speaks a changed prompt (at most every 3 s) and repeats an unchanged one every 6 s.
        if mode == .patient, let issue {
            let since = lastSpoken.map { sample.time - $0.time } ?? .infinity
            if since >= 3, lastSpoken?.issue != issue || since >= 6 {
                speaker?.speak(issue.prompt(for: step.view))
                lastSpoken = (issue, sample.time)
            }
        }
        if status.shouldStartRecording { beginRecording(step) }
    }

    private func beginRecording(_ step: AssessmentBattery.Step) {
        phase = .recording
        holdProgress = 0
        if mode == .patient { speaker?.speak("Recording. Hold still.") }
        work = Task { [weak self] in await self?.runStep(step) }
    }

    private func runStep(_ step: AssessmentBattery.Step) async {
        guard !halted else { return }
        let clip: RecordedClip
        do {
            clip = try await recorder.record(duration: step.durationSeconds ?? 0, minFps: step.minFps)
        } catch {
            if !halted { phase = .result(.notRecorded) }
            return
        }
        guard !halted else {
            try? FileManager.default.removeItem(at: clip.fileURL)
            return
        }

        let sidecar = ClipCapture(
            clipId: makeClipId(),
            sessionId: credentials.sessionId,
            stepId: step.stepId,
            view: step.view,
            recordedAt: clip.recordedAt,
            nominalFps: clip.nominalFps,
            width: clip.width,
            height: clip.height,
            frames: clip.frames,
            intrinsics: nil,
            device: .init(model: device.model, lens: clip.lens, appVersion: device.appVersion),
            provenance: .clipRecorder(producedAt: Date())
        )

        phase = .uploading
        let item: PendingClipUpload
        do {
            item = try await queue.enqueue(clipFile: clip.fileURL, sidecar: sidecar, token: credentials.token)
        } catch {
            try? FileManager.default.removeItem(at: clip.fileURL)
            if !halted { phase = .result(.notRecorded) }
            return
        }

        var uploaded: ClipUploadResponse?
        for attempt in 0..<max(uploadAttempts, 1) {
            guard !halted else { return }
            if attempt > 0 { await sleep(pollInterval) }
            switch await queue.send(item.uploadId) {
            case .uploaded(let response):
                uploaded = response
            case .willRetry:
                continue
            case .rejected, .notFound:
                if !halted { phase = .refused }
                return
            }
            if uploaded != nil { break }
        }
        guard !halted else { return }
        guard let uploaded else {
            phase = .result(.notSent)
            return
        }

        phase = .processing
        for poll in 0..<max(maxPolls, 1) {
            guard !halted else { return }
            if poll > 0 { await sleep(pollInterval) }
            guard let statuses = try? await statusClient.fetch(credentials: credentials),
                  let status = statuses.first(where: { $0.stepId == step.stepId }) else { continue }
            if let clipId = status.clipId, clipId != uploaded.clipId { continue }
            switch status.status {
            case .analyzed:
                guard !halted else { return }
                phase = .result(status.usable == true ? .looksGood : .redo(reasons: status.reasons.map(QualityReasonText.plain)))
                speakOutcome()
                return
            case .failed:
                guard !halted else { return }
                phase = .result(status.reasons.isEmpty ? .notAnalysed : .redo(reasons: status.reasons.map(QualityReasonText.plain)))
                speakOutcome()
                return
            case .missing, .processing, .unknown:
                continue
            }
        }
        if !halted { phase = .result(.stillProcessing) }
    }

    private func speakOutcome() {
        guard mode == .patient, case .result(let outcome) = phase else { return }
        switch outcome {
        case .looksGood: speaker?.speak("Looks good.")
        case .redo: speaker?.speak("This step needs to be done again.")
        default: break
        }
    }

    func redo() {
        guard case .result = phase else { return }
        beginStep(stepIndex)
    }

    func next() {
        guard case .result = phase else { return }
        if stepIndex + 1 < steps.count {
            beginStep(stepIndex + 1)
        } else {
            finish()
        }
    }

    private func finish() {
        phase = .finished
        recorder.halt()
        onFinished?()
    }

    /// Symptom stop. Synchronous and local: capture and speech stop here,
    /// before any network call; queued clips of this session are then dropped.
    func haltLocally() {
        guard !halted else { return }
        halted = true
        recorder.halt()
        speaker?.stop()
        work?.cancel()
        phase = .stopped
        onStopped?()
        let queue = self.queue
        let sessionId = credentials.sessionId
        cleanup = Task { await queue.discard(sessionId: sessionId) }
    }
}
