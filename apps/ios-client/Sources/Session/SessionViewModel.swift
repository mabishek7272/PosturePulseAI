import AVFoundation
import Foundation
import SwiftUI

/// Orchestrates capture -> encode -> upload -> render for one session. Camera
/// capture and frame encoding are local; pose/quality inference is not (it
/// runs in ml-service, reached via backend-api - see root README.md).
@MainActor
final class SessionViewModel: ObservableObject {
    let credentials: SessionCredentials
    var sessionId: String { credentials.sessionId }

    @Published private(set) var safetyState: SafetyState = .setup
    @Published private(set) var latestFrame: PoseLandmarkFrame?
    @Published private(set) var latestQualityGateFlag: QualityGateFlag?
    @Published private(set) var latestDecisionEvent: DecisionEvent?

    private let capture = CameraCaptureController()
    private let encoder = FrameEncoder()
    private let uploader = FrameStreamingClient()
    private var socket: SessionWebSocketClient?
    private var frameCounter = 0

    init(credentials: SessionCredentials) {
        self.credentials = credentials
    }

    func start() throws {
        try capture.configure()
        capture.delegate = self
        capture.start()

        let socket = SessionWebSocketClient(credentials: credentials)
        socket.onStateChange = { [weak self] state in
            Task { @MainActor in self?.safetyState = state }
        }
        socket.onQualityGateFlag = { [weak self] flag in
            Task { @MainActor in self?.latestQualityGateFlag = flag }
        }
        socket.onDecisionEvent = { [weak self] event in
            Task { @MainActor in self?.latestDecisionEvent = event }
        }
        socket.onPoseLandmarkFrame = { [weak self] frame in
            Task { @MainActor in self?.latestFrame = frame }
        }
        socket.connect()
        self.socket = socket
    }

    /// Local-first stop path used by SymptomStopButton - halts capture
    /// synchronously, before any network call is made.
    func haltLocally() {
        capture.stop()
    }

    func stop() {
        capture.stop()
        socket?.disconnect()
        socket = nil
    }

    fileprivate func handleCapturedFrame(_ sampleBuffer: CMSampleBuffer) {
        frameCounter += 1
        let frameId = "\(sessionId):\(frameCounter)"
        guard let jpegData = encoder.encodeJPEG(from: sampleBuffer) else { return }

        Task {
            do {
                _ = try await uploader.submitFrame(
                    credentials: credentials,
                    frameId: frameId,
                    capturedAt: Date(),
                    imageData: jpegData
                )
            } catch {
                // Network failure uploading a frame is not a safety event by
                // itself - the local symptom-stop path does not depend on
                // frame upload succeeding. A dropped frame simply produces no
                // update; the UI's "measurement unavailable" state (driven by
                // the last-known qualityGateFlag/staleness) covers this.
            }
        }
    }
}

extension SessionViewModel: CameraCaptureDelegate {
    nonisolated func cameraCaptureController(_ controller: CameraCaptureController, didCapture sampleBuffer: CMSampleBuffer, at timestamp: CMTime) {
        Task { @MainActor in
            self.handleCapturedFrame(sampleBuffer)
        }
    }
}
