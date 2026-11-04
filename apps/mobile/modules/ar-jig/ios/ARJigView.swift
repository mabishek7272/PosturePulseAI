import ARKit
import ExpoModulesCore

/// Expo view hosting the AR jig. It renders only the camera feed and the 3D mat;
/// the HUD is React's job, driven by the `onGate` event.
class ARJigView: ExpoView {

    // Event names must match the `Events(...)` list in ARJigModule.
    let onGate = EventDispatcher()
    let onRecordingProgress = EventDispatcher()
    let onRecorded = EventDispatcher()
    let onCaptureError = EventDispatcher()

    private let engine = ARJigEngine()

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        clipsToBounds = true
        backgroundColor = .black
        engine.attach(to: self)

        engine.onGate = { [weak self] state in
            self?.onGate(state.payload)
        }
        engine.onProgress = { [weak self] progress in
            self?.onRecordingProgress(["progress": progress])
        }
        engine.onRecorded = { [weak self] clip in
            self?.onRecorded(clip.payload)
        }
        engine.onError = { [weak self] error in
            self?.onCaptureError(["code": error.rawValue, "message": error.message])
        }
    }

    // MARK: Props

    func setThresholds(_ thresholds: ARJigThresholds) { engine.thresholds = thresholds }
    func setClipSeconds(_ seconds: Double) { engine.clipSeconds = seconds }
    func setMinFps(_ fps: Double) { engine.minFps = fps }
    func setBitRate(_ bitRate: Int) { engine.averageBitRate = bitRate }

    /// Drives the ARSession. React unmounting the view also stops it, but an
    /// explicit prop lets a screen pause the session when it loses focus without
    /// tearing down the view and losing the placed mat.
    func setActive(_ active: Bool) {
        if active { engine.start() } else { engine.pause() }
    }

    // MARK: View functions (exposed on the React ref)

    func startRecording() { engine.startRecording() }
    func stopRecording() { engine.stopRecording() }
    /// ADR-005 safety stop: abandons the take and deletes the partial file.
    func halt() { engine.halt() }
    func placeMatAhead() { engine.placeMatAhead() }
    func clearMat() { engine.clearMat() }

    override func willMove(toWindow newWindow: UIWindow?) {
        super.willMove(toWindow: newWindow)
        // Leaving the hierarchy mid-take must never leave a partial clip behind
        // that could later be mistaken for a complete one.
        if newWindow == nil { engine.pause() }
    }
}
