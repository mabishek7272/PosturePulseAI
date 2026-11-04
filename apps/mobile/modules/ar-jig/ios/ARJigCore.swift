import Foundation
import simd

// MARK: - Conventions this module is bound by
//
// The sidecar frames this module produces are consumed by
// `services/ml-service/app/quality/clip_quality.py`. Three conventions are
// load-bearing; getting any of them wrong means every clip is rejected.
//
// 1. SIDECAR CAMERA FRAME C (packages/schemas/src/clip-capture.schema.json):
//      x = image right, y = image DOWN, z = optical axis AWAY from the camera.
//    A level camera filming upright reports gravity ~= [0, 1, 0].
//
// 2. PITCH is `asin(|g_z|)` in degrees, so it is ZERO when the optical axis is
//    horizontal — NOT 90. The server rejects a clip whose median hold pitch
//    exceeds `2 * levelToleranceDegrees`; every step in
//    `references/assessment-battery.v0-draft.json` uses a tolerance of 6, so
//    **pitch above 12 degrees is rejected**. The default gate below is stricter,
//    so a passing gate can never produce a server-rejected clip.
//
// 3. ROLL is corrected server-side (`correct_roll`) rather than rejected, so the
//    roll gate is a quality nicety, not a hard server requirement.
//
// These three functions are mirrored from
// `apps/ios-client/Sources/Capture/CameraGravity.swift` and are pinned by
// `apps/ios-client/Tests/ARJigGravityTests.swift` (8 tests). If you change the
// maths here, change it there and re-run those tests — they are the executable
// specification of the convention.

/// Gravity/angle maths for the sidecar's camera frame C.
enum ARJigMath {
    /// Returns nil for a degenerate vector. Never a placeholder: a sidecar full
    /// of zeros would tell the server the device was in free fall
    /// (CLAUDE.md rule 3 — never fabricate a measurement).
    static func normalised(_ v: [Double]) -> [Double]? {
        guard v.count == 3 else { return nil }
        let n = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).squareRoot()
        guard n > 1e-9, n.isFinite else { return nil }
        return v.map { $0 / n }
    }

    /// In-plane tilt of the image against true vertical, degrees. Positive when
    /// gravity leans toward image right.
    static func rollDegrees(_ c: [Double]) -> Double {
        guard c.count == 3 else { return .nan }
        return atan2(c[0], c[1]) * 180 / .pi
    }

    /// Tilt of the optical axis out of the horizontal plane, degrees (unsigned),
    /// as the analysis computes it: asin(|g_z|). Zero means level.
    static func pitchDegrees(_ c: [Double]) -> Double {
        guard c.count == 3 else { return .nan }
        return asin(min(abs(c[2]), 1)) * 180 / .pi
    }
}

/// The ARKit-transform -> sidecar-camera-frame gravity conversion.
///
/// `ARFrame.camera.gravity` DOES NOT EXIST. What makes gravity recoverable is
/// `worldAlignment = .gravity`: ARKit's world +Y is true up, so gravity in world
/// space is exactly (0, -1, 0), and projecting that onto the camera basis gives
/// gravity in camera space.
///
/// ARKit's camera basis (columns of `transform`) is x = right, y = up,
/// z = toward the viewer — so the optical axis is -z. Frame C wants x = image
/// right, y = image DOWN, z = optical axis AWAY. Hence:
///
///     C.x = gW . ( col0) = (0,-1,0) . col0  = -col0.y
///     C.y = gW . (-col1) = (0,-1,0) . -col1 =  col1.y
///     C.z = gW . (-col2) = (0,-1,0) . -col2 =  col2.y
///
/// Sanity check: a level camera filming upright has col1 ~= world up, giving
/// C = [0, 1, 0] — exactly the value the schema documents.
///
/// `camera.transform` is reported in ARKit's NATIVE sensor orientation, which is
/// also the orientation of `capturedImage` — the buffer this module encodes
/// unrotated. The two therefore agree with no interface-orientation correction.
enum ARJigGravity {
    static func cameraFrame(cameraTransform m: simd_float4x4) -> [Double]? {
        ARJigMath.normalised([
            Double(-m.columns.0.y),
            Double(m.columns.1.y),
            Double(m.columns.2.y),
        ])
    }
}

// MARK: - Gate configuration

/// Spatial gate thresholds. Distances in metres, angles in degrees.
///
/// These are engineering defaults, not values derived from clinical data. They
/// are kept in one struct so they can be retuned against a real iPad Pro in a
/// real clinic room without touching any logic.
public struct ARJigThresholds: Equatable {
    /// Pitch in the repo's convention: 0 = optical axis horizontal. A spec
    /// phrased as "90 +/- 3 from the gravity vector" is this same constraint
    /// expressed from the other end.
    public var maxPitchDegrees: Double = 3.0
    public var maxRollDegrees: Double = 2.0
    /// Camera altitude above the detected floor plane. ARKit's world up is +Y,
    /// so this is a Y displacement — not a Z one, which would be horizontal depth.
    public var minCameraHeight: Double = 0.9
    public var maxCameraHeight: Double = 1.3
    public var minDistance: Double = 2.3
    public var maxDistance: Double = 3.0
    public var idealDistance: Double = 2.5
    /// Any surface nearer than this inside the central band fails the gate.
    public var minSubjectClearance: Double = 1.5
    /// Fraction of sampled depth pixels nearer than `minSubjectClearance` that
    /// counts as a real obstruction rather than sensor noise.
    public var maxForegroundFraction: Double = 0.02
    /// Continuous time all conditions must hold before recording unlocks.
    public var stabilityHold: TimeInterval = 1.5

    public static let `default` = ARJigThresholds()

    /// The hard server-side pitch limit, degrees.
    ///
    /// `app/quality/clip_quality.py` rejects a clip whose median hold pitch
    /// exceeds `2 x levelToleranceDegrees`, and `levelToleranceDegrees` is 6 for
    /// every step in the v0 battery - so the limit is 12, not 6. The doubling is
    /// easy to miss, which is why this is a named constant rather than a literal
    /// at the point of use: `maxPitchDegrees` must stay below it, or the gate
    /// gives the operator a green light for a capture the server will refuse.
    public static let serverMaxPitchDegrees = 2.0 * 6.0
    public init() {}
}

/// Why the gate is closed, most blocking first. Fix the camera before the subject.
public enum ARJigBlocker: Equatable {
    case trackingUnavailable
    case trackingLimited(String)
    case noFloorPlane
    case cameraNotLevel(pitch: Double, roll: Double)
    case cameraTooLow(Double)
    case cameraTooHigh(Double)
    case tooClose(Double)
    case tooFar(Double)
    /// A surface closer than the clearance threshold occupies part of the central
    /// band. This is a geometric depth measurement, NOT person detection — it is
    /// deliberately not called "bystander detected", because LiDAR depth alone
    /// cannot identify a person (CLAUDE.md rule 3).
    case foregroundObstruction(nearest: Double)

    /// Stable machine-readable code for the JS layer, so React renders the copy
    /// and this module never ships user-facing wording.
    public var code: String {
        switch self {
        case .trackingUnavailable: return "tracking_unavailable"
        case .trackingLimited: return "tracking_limited"
        case .noFloorPlane: return "no_floor_plane"
        case .cameraNotLevel: return "camera_not_level"
        case .cameraTooLow: return "camera_too_low"
        case .cameraTooHigh: return "camera_too_high"
        case .tooClose: return "too_close"
        case .tooFar: return "too_far"
        case .foregroundObstruction: return "foreground_obstruction"
        }
    }

    /// Short English fallback, used only by the optional native debug HUD.
    public var debugMessage: String {
        switch self {
        case .trackingUnavailable: return "FINDING THE ROOM"
        case .trackingLimited(let why): return "TRACKING LIMITED — \(why)"
        case .noFloorPlane: return "AIM AT THE FLOOR"
        case .cameraNotLevel(let pitch, let roll):
            if abs(roll) > abs(pitch) { return roll > 0 ? "ROTATE LEFT" : "ROTATE RIGHT" }
            return "LEVEL THE CAMERA"
        case .cameraTooLow: return "RAISE THE CAMERA"
        case .cameraTooHigh: return "LOWER THE CAMERA"
        case .tooClose: return "TOO CLOSE — STEP BACK"
        case .tooFar: return "TOO FAR — STEP IN"
        case .foregroundObstruction: return "CLEAR THE FOREGROUND"
        }
    }
}

/// Everything the JS layer needs to render its own HUD, computed once per frame.
public struct ARJigGateState: Equatable {
    public var blockers: [ARJigBlocker] = [.trackingUnavailable]
    public var pitchDegrees: Double = .nan
    public var rollDegrees: Double = .nan
    public var cameraHeight: Double?
    public var distance: Double?
    /// Nearest surface in the central band; nil when the device gave no depth.
    public var nearestSurface: Double?
    public var stabilityProgress: Double = 0
    public var isOpen = false
    public var isRecording = false
    public var matPlaced = false
    /// Frames dropped mid-take because their gravity could not be certified.
    public var skippedFrames = 0

    public init() {}

    /// Payload for the `onGate` event.
    ///
    /// `EventDispatcher` takes `[String: Any]`, so a value that is genuinely
    /// unknown is OMITTED rather than sent as NaN (which does not survive JSON)
    /// or as a zero (which would be a fabricated reading). JS sees `undefined`
    /// and renders a dash — see the optional fields in ARJig.types.ts.
    public var payload: [String: Any] {
        var p: [String: Any] = [
            "isOpen": isOpen,
            "isRecording": isRecording,
            "matPlaced": matPlaced,
            "stabilityProgress": stabilityProgress,
            "skippedFrames": skippedFrames,
            "blockers": blockers.map { $0.code },
        ]
        if pitchDegrees.isFinite { p["pitchDegrees"] = pitchDegrees }
        if rollDegrees.isFinite { p["rollDegrees"] = rollDegrees }
        if let cameraHeight { p["cameraHeight"] = cameraHeight }
        if let distance { p["distance"] = distance }
        if let nearestSurface { p["nearestSurface"] = nearestSurface }
        if let primary = blockers.first?.code { p["primaryBlocker"] = primary }
        return p
    }
}

// MARK: - Errors

public enum ARJigCaptureError: String, Error {
    /// The device cannot run world tracking at all.
    case unsupportedDevice = "unsupported_device"
    /// No ARKit frame yet, so there is nothing to record.
    case sessionNotReady = "session_not_ready"
    /// `startRecording` called while the spatial gate is closed.
    case gateClosed = "gate_closed"
    /// AVAssetWriter could not be created or failed mid-write.
    case writerFailed = "writer_failed"
    /// Too few frames survived to meet the step's minimum frame rate.
    case insufficientFrameRate = "insufficient_frame_rate"
    /// Recording was abandoned locally (safety stop, backgrounding, teardown).
    case halted = "halted"

    public var message: String {
        switch self {
        case .unsupportedDevice: return "This device cannot run the AR jig."
        case .sessionNotReady: return "The AR session has no frame yet."
        case .gateClosed: return "The spatial gate is not open."
        case .writerFailed: return "The video writer failed."
        case .insufficientFrameRate: return "Too few frames were captured to meet the minimum frame rate."
        case .halted: return "Recording was stopped before it completed."
        }
    }
}

// MARK: - Result

/// A finished clip plus the per-frame sidecar entries recorded with it. The JS
/// layer turns this into a `ClipCapture` (clip-capture.schema.json) by adding the
/// ids, the view and the provenance it already owns.
public struct ARJigClip {
    public struct Frame {
        public let index: Int
        /// Seconds since the clip's first encoded frame.
        public let t: Double
        /// Unit gravity in the sidecar's camera frame C.
        public let gravity: [Double]
    }

    public let fileURL: URL
    public let frames: [Frame]
    /// Encoded frame size in pixels, as written — not the size requested.
    public let width: Int
    public let height: Int
    /// Derived from the frames actually encoded, never from the requested format.
    public let nominalFps: Double
    public let recordedAt: Date
    /// True pinhole intrinsics for the encoded buffer, which ARKit reports and
    /// the AVFoundation capture path cannot.
    public let intrinsics: (fx: Double, fy: Double, cx: Double, cy: Double)?
    /// Frames dropped because their gravity could not be certified.
    public let skippedFrames: Int
    /// The LiDAR depth track written alongside the video (ADR-020), or nil when
    /// the device produced none, the writer failed, or the track was empty. nil
    /// is a supported state end to end: the clip simply uploads without depth.
    public let depth: Depth?

    /// What the sidecar's `depth` block needs. Mirrors
    /// `packages/schemas/src/clip-capture.schema.json`.
    public struct Depth {
        public let fileURL: URL
        public let width: Int
        public let height: Int
        public let frameCount: Int
        public let sha256: String
        public let hasConfidence: Bool
        public let nominalFps: Double
        /// Seconds since the clip's first VIDEO frame, so a depth frame can be
        /// paired with a pose observation. Deliberately NOT index-aligned with
        /// `frames`: depth runs at ~15 Hz against video at 30-60 Hz, and gaps
        /// are real gaps, never interpolated.
        public let times: [Double]

        public var payload: [String: Any] {
            [
                "depthPath": fileURL.absoluteString,
                "width": width,
                "height": height,
                "encoding": "uint16_millimetres_deflate",
                "scaleMillimetres": 1,
                "nominalFps": nominalFps,
                "frameCount": frameCount,
                "sha256": sha256,
                "hasConfidence": hasConfidence,
                "frames": times.enumerated().map { index, t -> [String: Any] in
                    ["index": index, "t": t]
                },
            ]
        }
    }

    public var payload: [String: Any] {
        var p: [String: Any] = [
            // `file://` so expo-file-system and the upload path can read it directly.
            "videoPath": fileURL.absoluteString,
            "width": width,
            "height": height,
            "nominalFps": nominalFps,
            "recordedAt": ARJigISO8601.string(from: recordedAt),
            "skippedFrames": skippedFrames,
            "frames": frames.map { frame -> [String: Any] in
                ["index": frame.index, "t": frame.t, "gravity": frame.gravity]
            },
            "device": ARJigDeviceInfo.current.payload,
        ]
        // Omitted, not nulled, when the device reported no usable resolution.
        if let intrinsics {
            p["intrinsics"] = ["fx": intrinsics.fx, "fy": intrinsics.fy,
                               "cx": intrinsics.cx, "cy": intrinsics.cy]
        }
        // Likewise omitted when there is no depth track. JS must not send a
        // `depth` block describing a file that does not exist.
        if let depth { p["depth"] = depth.payload }
        return p
    }
}

enum ARJigISO8601 {
    private static let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static func string(from date: Date) -> String { formatter.string(from: date) }
}

/// Hardware identifier and app version for the sidecar's `device` block.
struct ARJigDeviceInfo {
    let model: String
    let appVersion: String

    static var current: ARJigDeviceInfo {
        var systemInfo = utsname()
        uname(&systemInfo)
        let machine = withUnsafeBytes(of: &systemInfo.machine) { raw in
            String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
        }
        let model = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? machine
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "0"
        let build = info?["CFBundleVersion"] as? String ?? "0"
        return ARJigDeviceInfo(model: model, appVersion: "\(version) (\(build))")
    }

    var payload: [String: Any] {
        // The back wide camera is the only lens ARKit world tracking uses.
        ["model": model, "lens": "back_wide", "appVersion": appVersion]
    }
}
