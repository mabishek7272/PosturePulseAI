import AVFoundation
import Foundation
import SwiftUI

/// Orchestrates capture -> encode -> upload -> render for one session. Camera
/// capture and frame encoding are local; pose/quality inference is not (it
/// runs in ml-service, reached via backend-api - see root README.md).
@MainActor
final class SessionViewModel: ObservableObject {
    let sessionId: String

    @Published private(set) var safetyState: SafetyState = .setup
    @Published private(set) var latestFrame: PoseLandmarkFrame?
    @Published private(set) var latestQualityGateFlag: QualityGateFlag?
    @Published private(set) var latestDecisionEvent: DecisionEvent?
    /// Non-nil whenever spatial (AR-anchored) measurement is unavailable -
    /// drives TwoDFallbackBanner. nil means AR tracking is normal.
    @Published private(set) var twoDFallbackReason: TwoDFallbackBanner.Reason?

    private let capture = CameraCaptureController()
    private let encoder = FrameEncoder()
    private let uploader = FrameStreamingClient()
    private let arSession = ARSessionController()
    private let poseStreamer = CameraPoseStreamingClient()
    private var socket: SessionWebSocketClient?
    private var frameCounter = 0

    init(sessionId: String) {
        self.sessionId = sessionId
    }

    func start() throws {
        try capture.configure()
        capture.delegate = self
        capture.start()
        startArSessionIfSupported()

        let socket = SessionWebSocketClient(sessionId: sessionId)
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
        arSession.stop()
        socket?.disconnect()
        socket = nil
    }

    /// 2D fallback (TRD 2.3) is a first-class named mode, not an implicit
    /// default: a device with no AR support never attempts to stream camera
    /// poses, and never claims a worldAnchorId it can't back with real
    /// tracking. See TwoDFallbackBanner.
    private func startArSessionIfSupported() {
        guard ARSessionController.isWorldTrackingSupported else {
            twoDFallbackReason = .unsupportedDevice
            return
        }
        arSession.onTrackingDegraded = { [weak self] degraded in
            Task { @MainActor in
                self?.twoDFallbackReason = degraded ? .trackingDegraded : nil
            }
        }
        arSession.onCameraPose = { [weak self] pose in
            guard let self else { return }
            Task {
                do {
                    try await self.poseStreamer.submit(sessionId: self.sessionId, pose: pose)
                } catch {
                    // Same rationale as handleCapturedFrame below - a dropped
                    // camera-pose sample is not itself a safety event.
                }
            }
        }
        arSession.start()
    }

    fileprivate func handleCapturedFrame(_ sampleBuffer: CMSampleBuffer) {
        frameCounter += 1
        let frameId = "\(sessionId):\(frameCounter)"
        guard let jpegData = encoder.encodeJPEG(from: sampleBuffer) else { return }

        Task {
            do {
                _ = try await uploader.submitFrame(
                    sessionId: sessionId,
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
