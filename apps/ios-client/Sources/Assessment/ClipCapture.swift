import Foundation

// Mirrors packages/schemas/src/clip-capture.schema.json (version v0).
// Hand-kept, not codegenned - see docs/adr/004-ios-dtos-hand-kept.md.
/// Sidecar uploaded with every assessment clip (ADR-013): true vertical and
/// real frame timing for each encoded frame. No identifiers beyond the
/// pseudonymous session.
struct ClipCapture: Codable, Equatable {
    let clipId: String
    let sessionId: String
    let stepId: String
    let view: StepView
    let recordedAt: Date
    let nominalFps: Double
    let width: Int
    let height: Int
    let frames: [Frame]
    let intrinsics: Intrinsics?
    let device: Device
    let provenance: Provenance

    struct Frame: Codable, Equatable {
        let index: Int
        /// Seconds since the clip's first frame (presentation timestamp).
        let t: Double
        /// Unit gravity in the camera frame of the oriented image.
        let gravity: [Double]
    }

    struct Intrinsics: Codable, Equatable {
        let fx: Double
        let fy: Double
        let cx: Double
        let cy: Double
    }

    struct Device: Codable, Equatable {
        enum Lens: String, Codable { case backWide = "back_wide", backUltrawide = "back_ultrawide", front }
        let model: String
        let lens: Lens
        let appVersion: String
    }

    enum CodingKeys: String, CodingKey {
        case clipId, sessionId, stepId, view, recordedAt, nominalFps, width, height, frames, intrinsics, device, provenance
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(clipId, forKey: .clipId)
        try c.encode(sessionId, forKey: .sessionId)
        try c.encode(stepId, forKey: .stepId)
        try c.encode(view, forKey: .view)
        try c.encode(recordedAt, forKey: .recordedAt)
        try c.encode(nominalFps, forKey: .nominalFps)
        try c.encode(width, forKey: .width)
        try c.encode(height, forKey: .height)
        try c.encode(frames, forKey: .frames)
        // Sent as an explicit null: the device did not report intrinsics.
        try c.encode(intrinsics, forKey: .intrinsics)
        try c.encode(device, forKey: .device)
        try c.encode(provenance, forKey: .provenance)
    }

    static var encoder: JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            try c.encode(ISO8601.string(from: date))
        }
        return e
    }
}

/// common.schema.json#/$defs/provenance.
struct Provenance: Codable, Equatable {
    let schemaVersion: String
    let modelVersion: String
    let adapterVersion: String?
    let calibrationVersion: String
    let producedAt: Date

    /// The sidecar is produced by the app's clip recorder from CoreMotion; no
    /// model and no camera calibration are involved.
    static func clipRecorder(producedAt: Date) -> Provenance {
        Provenance(
            schemaVersion: "clip-capture/v0",
            modelVersion: "posturepulse-ios-clip-recorder/v1",
            adapterVersion: "coremotion-gravity/v1",
            calibrationVersion: "none",
            producedAt: producedAt
        )
    }
}

enum ISO8601 {
    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let plain = ISO8601DateFormatter()

    static func string(from date: Date) -> String { withFraction.string(from: date) }

    static func date(from string: String) -> Date? {
        withFraction.date(from: string) ?? plain.date(from: string)
    }
}

/// Accumulates one sidecar frame entry per encoded frame.
struct SidecarBuilder {
    let orientation: ClipOrientation
    private(set) var frames: [ClipCapture.Frame] = []
    private var firstPresentationTime: Double?

    init(orientation: ClipOrientation) {
        self.orientation = orientation
    }

    /// `presentationTime` in seconds (any epoch); `deviceGravity` from
    /// CMDeviceMotion.gravity in device coordinates.
    mutating func append(presentationTime: Double, deviceGravity: [Double]) {
        let first = firstPresentationTime ?? presentationTime
        firstPresentationTime = first
        frames.append(.init(
            index: frames.count,
            t: max(presentationTime - first, 0),
            gravity: CameraGravity.cameraFrame(deviceGravity: deviceGravity, orientation: orientation)
        ))
    }

    var duration: Double { frames.last?.t ?? 0 }
}
