import CoreGraphics
import Foundation

/// A finished clip on disk plus the per-frame sidecar entries recorded with it.
struct RecordedClip {
    let fileURL: URL
    let frames: [ClipCapture.Frame]
    /// Encoded (oriented) frame size in pixels.
    let width: Int
    let height: Int
    let nominalFps: Double
    let recordedAt: Date
    let lens: ClipCapture.Device.Lens
}

enum ClipRecorderError: Error, Equatable {
    case cameraUnavailable
    case motionUnavailable
    case insufficientFrameRate
    case writerFailed
    case halted
}

/// Camera + motion + on-device pose for a battery step. The real
/// implementation (ClipRecorder) needs a device; BatteryRunner only talks to
/// this protocol so its logic is unit-tested with a fake.
protocol ClipRecording: AnyObject {
    /// Delivered on the main thread for every guidance (pose) frame.
    var onGuidanceSample: ((GuidanceSample) -> Void)? { get set }
    /// 0...1 progress of the current recording, on the main thread.
    var onRecordingProgress: ((Double) -> Void)? { get set }
    /// Oriented frame size the guidance coordinates refer to.
    var imageSize: CGSize { get }

    func startPreview() throws
    /// Records `duration` seconds from the next frame and returns the clip.
    func record(duration: TimeInterval, minFps: Double) async throws -> RecordedClip
    /// Local, synchronous halt (symptom stop): stops capture, abandons any
    /// recording in progress and deletes its partial file. No network I/O.
    func halt()
}

/// Hardware identifier and app version for the sidecar's `device`.
struct DeviceInfo: Equatable {
    let model: String
    let appVersion: String

    static var current: DeviceInfo {
        var systemInfo = utsname()
        uname(&systemInfo)
        let machine = withUnsafeBytes(of: &systemInfo.machine) { raw in
            String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
        }
        let model = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? machine
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "0"
        let build = info?["CFBundleVersion"] as? String ?? "0"
        return DeviceInfo(model: model, appVersion: "\(version) (\(build))")
    }
}
