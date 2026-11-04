import ARKit
import ExpoModulesCore

/// JS-settable gate thresholds. Every field is optional so JS can override one
/// without restating the rest; omitted fields keep the Swift defaults.
struct ARJigThresholdsRecord: Record {
    @Field var maxPitchDegrees: Double?
    @Field var maxRollDegrees: Double?
    @Field var minCameraHeight: Double?
    @Field var maxCameraHeight: Double?
    @Field var minDistance: Double?
    @Field var maxDistance: Double?
    @Field var idealDistance: Double?
    @Field var minSubjectClearance: Double?
    @Field var maxForegroundFraction: Double?
    @Field var stabilityHold: Double?

    func applied(to base: ARJigThresholds) -> ARJigThresholds {
        var t = base
        if let maxPitchDegrees { t.maxPitchDegrees = maxPitchDegrees }
        if let maxRollDegrees { t.maxRollDegrees = maxRollDegrees }
        if let minCameraHeight { t.minCameraHeight = minCameraHeight }
        if let maxCameraHeight { t.maxCameraHeight = maxCameraHeight }
        if let minDistance { t.minDistance = minDistance }
        if let maxDistance { t.maxDistance = maxDistance }
        if let idealDistance { t.idealDistance = idealDistance }
        if let minSubjectClearance { t.minSubjectClearance = minSubjectClearance }
        if let maxForegroundFraction { t.maxForegroundFraction = maxForegroundFraction }
        if let stabilityHold { t.stabilityHold = stabilityHold }
        return t
    }
}

public class ARJigModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ARJig")

        // `Constants([...])` is deprecated in SDK 58; `Constant` is the current form.
        //
        // Lets the app choose between the AR jig and the existing vision-camera
        // path at runtime instead of guessing from the device model.
        Constant("isSupported") { ARJigEngine.isSupported }
        Constant("hasLiDAR") { ARJigEngine.hasLiDAR }
        // The hard server-side limit the gate must stay inside: clip_quality.py
        // rejects a clip whose median hold pitch exceeds 2 x the step's
        // levelToleranceDegrees, which is 6 for every step in the v0 battery.
        Constant("serverMaxPitchDegrees") { 12.0 }

        View(ARJigView.self) {
            Events("onGate", "onRecordingProgress", "onRecorded", "onCaptureError")

            Prop("active") { (view: ARJigView, active: Bool) in
                view.setActive(active)
            }
            Prop("clipSeconds") { (view: ARJigView, seconds: Double) in
                view.setClipSeconds(seconds)
            }
            Prop("minFps") { (view: ARJigView, fps: Double) in
                view.setMinFps(fps)
            }
            Prop("bitRate") { (view: ARJigView, bitRate: Int) in
                view.setBitRate(bitRate)
            }
            Prop("thresholds") { (view: ARJigView, record: ARJigThresholdsRecord?) in
                view.setThresholds(record?.applied(to: .default) ?? .default)
            }

            // View-level functions land on the React ref and always run on the
            // main queue, which is where ARView and AVAssetWriter setup must happen.
            AsyncFunction("startRecording") { (view: ARJigView) in
                view.startRecording()
            }
            AsyncFunction("stopRecording") { (view: ARJigView) in
                view.stopRecording()
            }
            AsyncFunction("halt") { (view: ARJigView) in
                view.halt()
            }
            AsyncFunction("placeMatAhead") { (view: ARJigView) in
                view.placeMatAhead()
            }
            AsyncFunction("clearMat") { (view: ARJigView) in
                view.clearMat()
            }
        }
    }
}
