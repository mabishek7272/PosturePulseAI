import CoreGraphics
import XCTest
@testable import PostureAnalysisClient

// MARK: - Fakes

private final class FakeRecorder: ClipRecording {
    var onGuidanceSample: ((GuidanceSample) -> Void)?
    var onRecordingProgress: ((Double) -> Void)?
    let imageSize = CGSize(width: 1080, height: 1920)
    private(set) var previewStarted = false
    private(set) var halted = false
    private(set) var recordCalls: [(duration: TimeInterval, minFps: Double)] = []
    var previewError: Error?
    var recordError: Error?
    /// When set, record() waits until `finishRecording()` is called.
    var suspendRecording = false
    private var pending: CheckedContinuation<Void, Never>?

    func startPreview() throws {
        if let previewError { throw previewError }
        previewStarted = true
    }

    func record(duration: TimeInterval, minFps: Double) async throws -> RecordedClip {
        recordCalls.append((duration, minFps))
        if suspendRecording { await withCheckedContinuation { pending = $0 } }
        if let recordError { throw recordError }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mov")
        try Data([1, 2, 3]).write(to: file)
        return RecordedClip(
            fileURL: file,
            frames: [.init(index: 0, t: 0, gravity: [0, 1, 0]), .init(index: 1, t: 1.0 / 30, gravity: [0, 1, 0])],
            width: 1080, height: 1920, nominalFps: 30,
            recordedAt: Date(timeIntervalSince1970: 1_790_000_000), lens: .backWide
        )
    }

    func finishRecording() {
        pending?.resume()
        pending = nil
    }

    func halt() { halted = true }
}

private final class FakeQueue: ClipUploadQueueing {
    private(set) var enqueued: [ClipCapture] = []
    private(set) var tokens: [String] = []
    private(set) var discarded: [String] = []
    var results: [ClipUploadResult] = []
    private(set) var sends = 0

    func enqueue(clipFile: URL, sidecar: ClipCapture, token: String) async throws -> PendingClipUpload {
        enqueued.append(sidecar)
        tokens.append(token)
        try? FileManager.default.removeItem(at: clipFile)
        return PendingClipUpload(uploadId: "u\(enqueued.count)", sessionId: sidecar.sessionId, stepId: sidecar.stepId,
                                 token: token, createdAt: Date(), attempts: 0)
    }

    func send(_ uploadId: String) async -> ClipUploadResult {
        sends += 1
        return results.isEmpty ? .uploaded(.init(clipId: "clip-\(sends)", status: "uploaded")) : results.removeFirst()
    }

    func drain() async -> [String: ClipUploadResult] { [:] }

    func discard(sessionId: String) async { discarded.append(sessionId) }
}

private final class FakeStatus: StepStatusFetching {
    var responses: [[StepStatus]] = []
    private(set) var calls = 0

    func fetch(credentials: SessionCredentials) async throws -> [StepStatus] {
        calls += 1
        return responses.isEmpty ? [] : responses.removeFirst()
    }
}

private final class FakeSpeaker: InstructionSpeaking {
    private(set) var spoken: [String] = []
    private(set) var stopped = false
    func speak(_ text: String) { spoken.append(text) }
    func stop() { stopped = true }
}

// MARK: - Tests

@MainActor
final class BatteryRunnerTests: XCTestCase {
    private var recorder: FakeRecorder!
    private var queue: FakeQueue!
    private var status: FakeStatus!
    private var speaker: FakeSpeaker!

    private let battery = AssessmentBattery(version: "b/1", status: "draft", steps: [
        .init(stepId: "static.anterior", title: "Front view", instruction: "Face the camera.", view: .anterior, durationSeconds: 15),
        .init(stepId: "static.posterior", title: "Back view", instruction: "Turn your back.", view: .posterior, durationSeconds: 5),
        .init(stepId: "clinic.only", title: "Clinic", instruction: "x", view: .anterior, durationSeconds: 5, modes: [.clinic]),
    ])

    override func setUp() async throws {
        recorder = FakeRecorder()
        queue = FakeQueue()
        status = FakeStatus()
        speaker = FakeSpeaker()
    }

    private func runner(mode: SessionMode = .patient) -> BatteryRunner {
        BatteryRunner(
            battery: battery, mode: mode, credentials: SessionCredentials(sessionId: "s1", token: "tok"),
            recorder: recorder, queue: queue, statusClient: status, speaker: speaker,
            device: .init(model: "iPhone18,1", appVersion: "0.1.0 (2)"),
            pollInterval: 0, maxPolls: 5, uploadAttempts: 3,
            sleep: { _ in await Task.yield() },
            makeClipId: { "clip-local" }
        )
    }

    private func facingPose() -> BodyPose2D {
        BodyPose2D(joints: [
            .nose: .init(x: 0.50, y: 0.15, confidence: 0.9),
            .leftShoulder: .init(x: 0.58, y: 0.25, confidence: 0.9), .rightShoulder: .init(x: 0.42, y: 0.25, confidence: 0.9),
            .leftHip: .init(x: 0.55, y: 0.50, confidence: 0.9), .rightHip: .init(x: 0.45, y: 0.50, confidence: 0.9),
            .leftKnee: .init(x: 0.55, y: 0.70, confidence: 0.9), .rightKnee: .init(x: 0.45, y: 0.70, confidence: 0.9),
            .leftAnkle: .init(x: 0.55, y: 0.88, confidence: 0.9), .rightAnkle: .init(x: 0.45, y: 0.88, confidence: 0.9),
        ])
    }

    private func backPose() -> BodyPose2D {
        var p = facingPose()
        for (l, r) in [(BodyPose2D.Joint.leftShoulder, BodyPose2D.Joint.rightShoulder), (.leftHip, .rightHip), (.leftKnee, .rightKnee), (.leftAnkle, .rightAnkle)] {
            let a = p.joints[l]!; p.joints[l] = p.joints[r]; p.joints[r] = a
        }
        return p
    }

    /// Feeds ready samples until the runner leaves .guiding.
    private func becomeReady(_ r: BatteryRunner, pose: BodyPose2D? = nil, from t0: Double = 0) {
        var t = t0
        while r.phase == .guiding, t < t0 + 5 {
            recorder.onGuidanceSample?(GuidanceSample(time: t, pose: pose ?? facingPose(), cameraGravity: [0, 1, 0]))
            t += 0.1
        }
    }

    private func analysed(_ step: String, usable: Bool, reasons: [String] = [], clipId: String? = nil) -> [StepStatus] {
        [StepStatus(stepId: step, status: .analyzed, usable: usable, reasons: reasons, clipId: clipId)]
    }

    func testStartsGuidingTheFirstStepOfTheModeWithLiveCamera() {
        let r = runner()
        XCTAssertEqual(r.steps.map(\.stepId), ["static.anterior", "static.posterior"])
        XCTAssertEqual(runner(mode: .clinic).steps.count, 3)
        r.start()
        XCTAssertTrue(recorder.previewStarted)
        XCTAssertEqual(r.phase, .guiding)
        XCTAssertEqual(r.stepIndex, 0)
    }

    func testReadyGuidanceRecordsUploadsAndShowsLooksGood() async {
        status.responses = [analysed("static.anterior", usable: true)]
        let r = runner()
        r.start()
        becomeReady(r)
        XCTAssertEqual(r.phase, .recording)
        await r.work?.value

        XCTAssertEqual(recorder.recordCalls.first?.duration, 15)
        XCTAssertEqual(recorder.recordCalls.first?.minFps, 24)
        let sidecar = try! XCTUnwrap(queue.enqueued.first)
        XCTAssertEqual(sidecar.sessionId, "s1")
        XCTAssertEqual(sidecar.stepId, "static.anterior")
        XCTAssertEqual(sidecar.view, .anterior)
        XCTAssertEqual(sidecar.clipId, "clip-local")
        XCTAssertEqual(sidecar.frames.count, 2)
        XCTAssertEqual(sidecar.device, .init(model: "iPhone18,1", lens: .backWide, appVersion: "0.1.0 (2)"))
        XCTAssertEqual(sidecar.provenance.schemaVersion, "clip-capture/v0")
        XCTAssertEqual(queue.tokens, ["tok"])
        XCTAssertEqual(r.phase, .result(.looksGood))
    }

    func testUnusableStepShowsReasonsAndRedoGoesBackToGuiding() async {
        status.responses = [analysed("static.anterior", usable: false, reasons: ["out_of_frame"])]
        let r = runner()
        r.start()
        becomeReady(r)
        await r.work?.value
        XCTAssertEqual(r.phase, .result(.redo(reasons: ["Part of the body was outside the frame"])))

        r.redo()
        XCTAssertEqual(r.phase, .guiding)
        XCTAssertEqual(r.stepIndex, 0)
        // A redo needs a fresh ready hold: one sample is not enough.
        recorder.onGuidanceSample?(GuidanceSample(time: 10, pose: facingPose(), cameraGravity: [0, 1, 0]))
        XCTAssertEqual(r.phase, .guiding)
    }

    func testPollsUntilTheNewClipIsAnalysed() async {
        status.responses = [
            [StepStatus(stepId: "static.anterior", status: .missing, usable: nil, reasons: [])],
            [StepStatus(stepId: "static.anterior", status: .processing, usable: nil, reasons: [])],
            analysed("static.anterior", usable: false, reasons: ["subject_moving"], clipId: "an-older-clip"),
            analysed("static.anterior", usable: true, clipId: "clip-1"),
        ]
        let r = runner()
        r.start()
        becomeReady(r)
        await r.work?.value
        XCTAssertEqual(status.calls, 4)
        XCTAssertEqual(r.phase, .result(.looksGood))
    }

    func testFailedAnalysisOffersRedo() async {
        status.responses = [[StepStatus(stepId: "static.anterior", status: .failed, usable: false, reasons: [])]]
        let r = runner()
        r.start()
        becomeReady(r)
        await r.work?.value
        XCTAssertEqual(r.phase, .result(.notAnalysed))
    }

    func testStillProcessingAfterThePollLimit() async {
        let r = runner()
        r.start()
        becomeReady(r)
        await r.work?.value
        XCTAssertEqual(status.calls, 5)
        XCTAssertEqual(r.phase, .result(.stillProcessing))
    }

    func testNextAdvancesThroughEveryStepThenFinishes() async {
        status.responses = [analysed("static.anterior", usable: true), analysed("static.posterior", usable: true)]
        var finished = 0
        let r = runner()
        r.onFinished = { finished += 1 }
        r.start()
        becomeReady(r)
        await r.work?.value
        r.next()
        XCTAssertEqual(r.stepIndex, 1)
        XCTAssertEqual(r.phase, .guiding)
        becomeReady(r, pose: backPose(), from: 20)
        await r.work?.value
        XCTAssertEqual(queue.enqueued.map(\.stepId), ["static.anterior", "static.posterior"])
        XCTAssertEqual(recorder.recordCalls.last?.duration, 5)
        r.next()
        XCTAssertEqual(r.phase, .finished)
        XCTAssertEqual(finished, 1)
    }

    func testSymptomStopHaltsLocallyBeforeAnythingElse() async {
        recorder.suspendRecording = true
        var stopped = 0
        let r = runner()
        r.onStopped = { stopped += 1 }
        r.start()
        becomeReady(r)
        XCTAssertEqual(r.phase, .recording)
        for _ in 0..<100 where recorder.recordCalls.isEmpty { await Task.yield() }
        XCTAssertEqual(recorder.recordCalls.count, 1)

        r.haltLocally()
        // Synchronous: capture and speech are halted before any await.
        XCTAssertTrue(recorder.halted)
        XCTAssertTrue(speaker.stopped)
        XCTAssertEqual(r.phase, .stopped)
        XCTAssertEqual(stopped, 1)

        recorder.finishRecording()
        await r.work?.value
        XCTAssertTrue(queue.enqueued.isEmpty, "nothing recorded after a stop is uploaded")
        XCTAssertEqual(r.phase, .stopped)
        await r.cleanup?.value
        XCTAssertEqual(queue.discarded, ["s1"])

        // Guidance after a stop never restarts recording.
        becomeReady(r, from: 30)
        XCTAssertEqual(recorder.recordCalls.count, 1)
    }

    func testRefusedUploadEndsTheBattery() async {
        queue.results = [.rejected(status: 409)]
        let r = runner()
        r.start()
        becomeReady(r)
        await r.work?.value
        XCTAssertEqual(r.phase, .refused)
        XCTAssertEqual(status.calls, 0)
    }

    func testUnreachableServerKeepsTheClipQueuedAndLetsThePersonGoOn() async {
        queue.results = [.willRetry, .willRetry, .willRetry]
        let r = runner()
        r.start()
        becomeReady(r)
        await r.work?.value
        XCTAssertEqual(queue.sends, 3)
        XCTAssertEqual(r.phase, .result(.notSent))
        r.next()
        XCTAssertEqual(r.stepIndex, 1)
    }

    func testRecorderFailureOffersRedo() async {
        recorder.recordError = ClipRecorderError.insufficientFrameRate
        let r = runner()
        r.start()
        becomeReady(r)
        await r.work?.value
        XCTAssertEqual(r.phase, .result(.notRecorded))
        XCTAssertTrue(queue.enqueued.isEmpty)
    }

    func testCameraUnavailableIsReported() {
        recorder.previewError = ClipRecorderError.cameraUnavailable
        let r = runner()
        r.start()
        XCTAssertEqual(r.phase, .cameraUnavailable)
    }

    func testPatientModeSpeaksTheInstructionAndClinicModeDoesNot() {
        let patient = runner(mode: .patient)
        patient.start()
        XCTAssertEqual(speaker.spoken.first, "Face the camera.")

        speaker = FakeSpeaker()
        let clinic = runner(mode: .clinic)
        clinic.start()
        XCTAssertTrue(speaker.spoken.isEmpty)
    }

    func testGuidancePromptIsPublishedWithoutNumbers() {
        let r = runner()
        r.start()
        recorder.onGuidanceSample?(GuidanceSample(time: 0, pose: nil, cameraGravity: [0, 1, 0]))
        XCTAssertEqual(r.prompt, "Step into the frame")
        XCTAssertEqual(r.guidance?.isLevel, true)
        XCTAssertNil(r.pose)
    }

    func testPublishesTheLatestGuidancePoseForTheOverlay() {
        let r = runner()
        r.start()
        recorder.onGuidanceSample?(GuidanceSample(time: 0, pose: facingPose(), cameraGravity: [0, 1, 0]))
        XCTAssertEqual(r.pose, facingPose())
        XCTAssertEqual(r.imageSize, CGSize(width: 1080, height: 1920))
    }
}
