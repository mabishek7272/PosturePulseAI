import CoreGraphics
import Foundation

/// A 2D body pose from on-device guidance (Vision), in normalised image
/// coordinates of the oriented frame: origin top-left, x right, y down, 0...1.
/// Left/right are the person's own sides. Used only to guide framing - it is
/// never shown as a measurement and never uploaded.
struct BodyPose2D: Equatable {
    enum Joint: CaseIterable {
        case nose, leftEar, rightEar, leftShoulder, rightShoulder, leftElbow, rightElbow, leftWrist, rightWrist,
             leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle
    }

    enum Side { case left, right }

    struct Point: Equatable {
        let x: Double
        let y: Double
        let confidence: Double
    }

    var joints: [Joint: Point]
}

struct GuidanceSample {
    let time: TimeInterval
    let pose: BodyPose2D?
    /// Unit gravity in the camera frame of the oriented image; nil when motion is unavailable.
    let cameraGravity: [Double]?
    /// LiDAR-derived distance to the subject in metres, when the device has a
    /// LiDAR sensor and a reading was available for this frame; nil otherwise,
    /// in which case GuidanceEngine falls back to a frame-fill estimate.
    let distanceMeters: Double?

    init(time: TimeInterval, pose: BodyPose2D?, cameraGravity: [Double]?, distanceMeters: Double? = nil) {
        self.time = time
        self.pose = pose
        self.cameraGravity = cameraGravity
        self.distanceMeters = distanceMeters
    }
}

/// What stops a step from recording, most important first.
///
/// NOTE on ordering: `.tooFar` sits after `.cameraNotLevel` and `.outOfFrame`
/// (level and framing outrank it) but before `.noPerson`, `.wrongView` and
/// `.moving` (it outranks view/stillness) - see
/// `testTooFarOutranksViewAndStillnessButNotFramingOrLevel`. This is purely
/// the declaration order consumed via `allCases`; the actual runtime
/// precedence of which issues get surfaced is driven by the check order in
/// `update(_:)`, not by this enum's case order.
enum GuidanceIssue: CaseIterable, Equatable {
    case cameraNotLevel
    case outOfFrame
    case tooFar
    case noPerson
    case wrongView
    case moving

    /// Instruction for the person; never contains a number.
    func prompt(for view: StepView) -> String {
        switch self {
        case .cameraNotLevel: return "Level the phone"
        case .outOfFrame: return "Step back so your whole body is in view"
        case .tooFar: return "Come a bit closer"
        case .noPerson: return "Step into the frame"
        case .wrongView:
            switch view {
            case .anterior: return "Face the camera"
            case .posterior: return "Turn your back to the camera"
            case .leftLateral: return "Turn so your left side faces the camera"
            case .rightLateral: return "Turn so your right side faces the camera"
            }
        case .moving: return "Hold still"
        }
    }
}

struct GuidanceStatus: Equatable {
    var issues: [GuidanceIssue]
    var isLevel: Bool
    /// Image roll against true vertical, for the bubble level only.
    var rollDegrees: Double?
    /// Image pitch against true vertical, for the tilt toast only.
    var pitchDegrees: Double?
    /// 0...1 progress through the ready hold before recording starts.
    var readyProgress: Double
    var shouldStartRecording: Bool
}

/// On-device guidance rules for a battery step (2D versions of the analysis's
/// quality rules, M1 spec slice A): the phone is level, the whole body is in
/// frame, the body faces the way the step asks, and the hips are still.
/// Recording starts after `readyHold` seconds of all four.
final class GuidanceEngine {
    let view: StepView
    let levelToleranceDegrees: Double
    let imageSize: CGSize
    let readyHold: TimeInterval
    /// Vision joint confidences run lower than MediaPipe visibility; 0.3 is a
    /// guidance threshold only, not a measurement threshold.
    let minConfidence: Double
    /// Joints must sit at least this far (fraction of the frame) inside the edges.
    let edgeMargin: Double = 0.02
    let stillnessWindow: TimeInterval = 1.0
    let minStillnessSpan: TimeInterval = 0.5
    /// Hip-midpoint SD limit as a fraction of body height (same as the analysis).
    let maxHipSDFraction: Double = 0.02
    /// Lateral view: shoulder width under this fraction of shoulder-to-hip height.
    let lateralWidthFraction: Double = 0.35
    /// Head-to-ankle span under this fraction of the frame height reads as "too
    /// far" when no LiDAR distance reading is available. Guidance-only, not a
    /// measurement threshold - tune freely without touching the analysis pipeline.
    let tooFarSpanFraction: Double = 0.35
    /// LiDAR-only: distance beyond this reads as "too far".
    let tooFarDistanceMeters: Double = 3.0

    private var hipHistory: [(t: TimeInterval, x: Double, y: Double, height: Double)] = []
    private var readySince: TimeInterval?

    init(view: StepView, levelToleranceDegrees: Double, imageSize: CGSize, readyHold: TimeInterval = 1.5, minConfidence: Double = 0.3) {
        self.view = view
        self.levelToleranceDegrees = levelToleranceDegrees
        self.imageSize = imageSize
        self.readyHold = readyHold
        self.minConfidence = minConfidence
    }

    static func shouldDetectPose(frameIndex: Int) -> Bool { frameIndex % 3 == 0 }

    func reset() {
        hipHistory = []
        readySince = nil
    }

    func update(_ sample: GuidanceSample) -> GuidanceStatus {
        var issues: [GuidanceIssue] = []

        let roll = sample.cameraGravity.map(CameraGravity.rollDegrees)
        let pitch = sample.cameraGravity.map(CameraGravity.pitchDegrees)
        let isLevel = roll.map { abs($0) <= levelToleranceDegrees } == true
            && pitch.map { $0 <= levelToleranceDegrees } == true
        if !isLevel { issues.append(.cameraNotLevel) }

        if isTooFar(sample) { issues.append(.tooFar) }

        if let pose = sample.pose, pose.joints.values.filter({ $0.confidence >= minConfidence }).count >= 4 {
            if !isFramed(pose) {
                issues.append(.outOfFrame)
                hipHistory = []
            } else {
                if !matchesView(pose) { issues.append(.wrongView) }
                if !isStill(pose, at: sample.time) { issues.append(.moving) }
            }
        } else {
            issues.append(.noPerson)
            hipHistory = []
        }

        var progress = 0.0
        var start = false
        if issues.isEmpty {
            let since = readySince ?? sample.time
            readySince = since
            progress = min((sample.time - since) / readyHold, 1)
            start = sample.time - since >= readyHold - 1e-9
        } else {
            readySince = nil
        }
        return GuidanceStatus(issues: issues, isLevel: isLevel, rollDegrees: roll, pitchDegrees: pitch, readyProgress: progress, shouldStartRecording: start)
    }

    // MARK: - Rules

    private func ok(_ point: BodyPose2D.Point?) -> BodyPose2D.Point? {
        guard let point, point.confidence >= minConfidence else { return nil }
        return point
    }

    private func inside(_ p: BodyPose2D.Point) -> Bool {
        p.x >= edgeMargin && p.x <= 1 - edgeMargin && p.y >= edgeMargin && p.y <= 1 - edgeMargin
    }

    private var nearSide: BodyPose2D.Side? {
        switch view {
        case .leftLateral: return .left
        case .rightLateral: return .right
        case .anterior, .posterior: return nil
        }
    }

    private func requiredJoints() -> [BodyPose2D.Joint] {
        switch nearSide {
        case .left?: return [.leftShoulder, .leftHip, .leftKnee, .leftAnkle]
        case .right?: return [.rightShoulder, .rightHip, .rightKnee, .rightAnkle]
        case nil: return [.leftShoulder, .rightShoulder, .leftHip, .rightHip, .leftKnee, .rightKnee, .leftAnkle, .rightAnkle]
        }
    }

    private func head(_ pose: BodyPose2D) -> BodyPose2D.Point? {
        ok(pose.joints[.nose]) ?? ok(pose.joints[.leftEar]) ?? ok(pose.joints[.rightEar])
    }

    private func isFramed(_ pose: BodyPose2D) -> Bool {
        guard let head = head(pose), inside(head) else { return false }
        return requiredJoints().allSatisfy { joint in ok(pose.joints[joint]).map(inside) ?? false }
    }

    /// LiDAR distance when available (more precise); otherwise a frame-fill
    /// estimate from the pose's head-to-ankle span. Never flags "too far" when
    /// there's no pose at all - that's .noPerson's job, not this one's.
    private func isTooFar(_ sample: GuidanceSample) -> Bool {
        if let distance = sample.distanceMeters { return distance > tooFarDistanceMeters }
        guard let pose = sample.pose, let head = head(pose) else { return false }
        let ankles = [ok(pose.joints[.leftAnkle]), ok(pose.joints[.rightAnkle])].compactMap { $0 }
        guard !ankles.isEmpty else { return false }
        let ankleY = ankles.map(\.y).reduce(0, +) / Double(ankles.count)
        let span = abs(ankleY - head.y)
        return span < tooFarSpanFraction
    }

    private func px(_ p: BodyPose2D.Point) -> (x: Double, y: Double) {
        (p.x * Double(imageSize.width), p.y * Double(imageSize.height))
    }

    private func sideConfidence(_ pose: BodyPose2D, _ side: BodyPose2D.Side) -> Double {
        let joints: [BodyPose2D.Joint] = side == .left
            ? [.leftShoulder, .leftHip, .leftKnee, .leftAnkle, .leftEar]
            : [.rightShoulder, .rightHip, .rightKnee, .rightAnkle, .rightEar]
        return joints.map { pose.joints[$0]?.confidence ?? 0 }.reduce(0, +)
    }

    private func matchesView(_ pose: BodyPose2D) -> Bool {
        let ls = ok(pose.joints[.leftShoulder]), rs = ok(pose.joints[.rightShoulder])
        switch view {
        case .anterior:
            guard let ls, let rs else { return false }
            return ls.x > rs.x
        case .posterior:
            guard let ls, let rs else { return false }
            return ls.x < rs.x
        case .leftLateral, .rightLateral:
            let near = nearSide!
            let far: BodyPose2D.Side = near == .left ? .right : .left
            guard sideConfidence(pose, near) > sideConfidence(pose, far) else { return false }
            // Width check needs both shoulders; a hidden far shoulder already reads as side-on.
            guard let ls, let rs else { return true }
            let hips = [ok(pose.joints[.leftHip]), ok(pose.joints[.rightHip])].compactMap { $0 }
            guard !hips.isEmpty else { return false }
            let shoulderWidth = abs(px(ls).x - px(rs).x)
            let shoulderY = (px(ls).y + px(rs).y) / 2
            let hipY = hips.map { px($0).y }.reduce(0, +) / Double(hips.count)
            return shoulderWidth < lateralWidthFraction * abs(hipY - shoulderY)
        }
    }

    private func isStill(_ pose: BodyPose2D, at time: TimeInterval) -> Bool {
        let hips = [ok(pose.joints[.leftHip]), ok(pose.joints[.rightHip])].compactMap { $0 }.map(px)
        let ankles = [ok(pose.joints[.leftAnkle]), ok(pose.joints[.rightAnkle])].compactMap { $0 }.map(px)
        guard !hips.isEmpty, !ankles.isEmpty, let head = head(pose) else { return false }
        let hipX = hips.map(\.x).reduce(0, +) / Double(hips.count)
        let hipY = hips.map(\.y).reduce(0, +) / Double(hips.count)
        let ankleY = ankles.map(\.y).reduce(0, +) / Double(ankles.count)
        let height = abs(ankleY - px(head).y)

        hipHistory.append((time, hipX, hipY, height))
        hipHistory.removeAll { time - $0.t > stillnessWindow + 1e-9 }
        guard let first = hipHistory.first, time - first.t >= minStillnessSpan - 1e-9, hipHistory.count >= 3 else { return false }

        let n = Double(hipHistory.count)
        let mx = hipHistory.map(\.x).reduce(0, +) / n
        let my = hipHistory.map(\.y).reduce(0, +) / n
        let variance = hipHistory.map { ($0.x - mx) * ($0.x - mx) + ($0.y - my) * ($0.y - my) }.reduce(0, +) / n
        let medianHeight = hipHistory.map(\.height).sorted()[hipHistory.count / 2]
        return variance.squareRoot() <= maxHipSDFraction * medianHeight
    }
}
