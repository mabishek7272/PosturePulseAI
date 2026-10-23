import SwiftUI

/// Draws the on-device guidance pose as an animated neon skeleton over the
/// letterboxed camera preview, so the person can see they are framed. Purely
/// decorative (docs/superpowers/specs/2026-10-23-neon-shell-redesign-design.md
/// §4.5) - no angles, no numbers, no colours that suggest good or bad. When a
/// joint isn't confidently detected, the bones touching it simply aren't
/// drawn - never guessed.
struct SkeletonOverlay: View {
    let pose: BodyPose2D?
    /// Oriented camera frame size, to place the letterboxed image.
    let imageSize: CGSize

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Every bone this overlay can draw. A bone is only drawn when both its
    /// joints are present with at least `minConfidence` (see `visibleBoneJoints`).
    static let bones: [(BodyPose2D.Joint, BodyPose2D.Joint)] = [
        (.nose, .leftShoulder), (.nose, .rightShoulder),
        (.leftShoulder, .rightShoulder),
        (.leftShoulder, .leftElbow), (.leftElbow, .leftWrist),
        (.rightShoulder, .rightElbow), (.rightElbow, .rightWrist),
        (.leftShoulder, .leftHip), (.rightShoulder, .rightHip),
        (.leftHip, .rightHip),
        (.leftHip, .leftKnee), (.leftKnee, .leftAnkle),
        (.rightHip, .rightKnee), (.rightKnee, .rightAnkle),
    ]

    /// The 13 joints this overlay ever draws a dot for (head/nose, shoulders,
    /// elbows, wrists, hips, knees, ankles). A subset of BodyPose2D.Joint.allCases:
    /// the ears are still tracked for guidance (GuidanceEngine's near-side
    /// detection) but are never drawn by this overlay.
    static let drawnJoints: [BodyPose2D.Joint] = [
        .nose, .leftShoulder, .rightShoulder, .leftElbow, .rightElbow, .leftWrist, .rightWrist,
        .leftHip, .rightHip, .leftKnee, .rightKnee, .leftAnkle, .rightAnkle,
    ]

    private static let minConfidence = 0.3

    /// Pure: which bones have both endpoints confidently detected. No pose ->
    /// no bones. A bone with one missing or low-confidence joint is left out,
    /// never drawn from a guessed position.
    static func visibleBoneJoints(for pose: BodyPose2D?, minConfidence: Double = SkeletonOverlay.minConfidence) -> [(BodyPose2D.Joint, BodyPose2D.Joint)] {
        guard let pose else { return [] }
        return bones.filter { a, b in
            (pose.joints[a]?.confidence ?? 0) >= minConfidence && (pose.joints[b]?.confidence ?? 0) >= minConfidence
        }
    }

    /// Pure: which of the 13 drawn joints are confidently detected.
    static func visibleJoints(for pose: BodyPose2D?, minConfidence: Double = SkeletonOverlay.minConfidence) -> [BodyPose2D.Joint] {
        guard let pose else { return [] }
        return drawnJoints.filter { (pose.joints[$0]?.confidence ?? 0) >= minConfidence }
    }

    /// A gentle quadratic curve between two points, bulging perpendicular to
    /// the segment - smoother than a straight line, matching the brainstormed
    /// mockup (docs/superpowers/specs/2026-10-23-neon-shell-redesign-design.md §4.5).
    static func curvedBone(from a: CGPoint, to b: CGPoint) -> Path {
        let mid = CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
        let dx = b.x - a.x, dy = b.y - a.y
        let length = max(hypot(dx, dy), 1)
        let px = -dy / length, py = dx / length // perpendicular unit vector
        let bulge = length * 0.12
        let control = CGPoint(x: mid.x + px * bulge, y: mid.y + py * bulge)
        var path = Path()
        path.move(to: a)
        path.addQuadCurve(to: b, control: control)
        return path
    }

    var body: some View {
        GeometryReader { geo in
            let rect = Self.fittedRect(image: imageSize, in: geo.size)
            TimelineView(.animation(paused: reduceMotion)) { timeline in
                Canvas { context, _ in
                    guard let pose else { return }
                    func point(_ joint: BodyPose2D.Joint) -> CGPoint? {
                        guard let p = pose.joints[joint], p.confidence >= Self.minConfidence else { return nil }
                        return CGPoint(x: rect.minX + p.x * rect.width, y: rect.minY + p.y * rect.height)
                    }
                    let phase = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.6) / 1.6

                    for (a, b) in Self.visibleBoneJoints(for: pose) {
                        guard let pa = point(a), let pb = point(b) else { continue }
                        let path = Self.curvedBone(from: pa, to: pb)
                        let gradient = GraphicsContext.Shading.linearGradient(
                            Gradient(colors: [NeonTheme.mint, NeonTheme.violet]),
                            startPoint: pa, endPoint: pb
                        )
                        // Glow: a wider, dimmer duplicate stroke beneath the sharp one -
                        // no GraphicsContext blur filter, so this stays iOS-16-safe.
                        context.stroke(path, with: .color(NeonTheme.violet.opacity(0.35)), style: StrokeStyle(lineWidth: 9, lineCap: .round))
                        context.stroke(
                            path, with: gradient,
                            style: StrokeStyle(
                                lineWidth: 3, lineCap: .round,
                                dash: reduceMotion ? [] : [6, 10],
                                dashPhase: reduceMotion ? 0 : -phase * 16
                            )
                        )
                    }

                    for joint in Self.visibleJoints(for: pose) {
                        guard let p = point(joint) else { continue }
                        let pulse = reduceMotion ? 1.0 : 1.0 + 0.25 * sin(phase * 2 * .pi)
                        let radius = 4.5 * pulse
                        context.fill(
                            Path(ellipseIn: CGRect(x: p.x - radius - 3, y: p.y - radius - 3, width: (radius + 3) * 2, height: (radius + 3) * 2)),
                            with: .color(NeonTheme.violet.opacity(0.3))
                        )
                        context.fill(Path(ellipseIn: CGRect(x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2)), with: .color(.white))
                    }
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static func fittedRect(image: CGSize, in container: CGSize) -> CGRect {
        guard image.width > 0, image.height > 0, container.width > 0, container.height > 0 else { return .zero }
        let scale = min(container.width / image.width, container.height / image.height)
        let size = CGSize(width: image.width * scale, height: image.height * scale)
        return CGRect(x: (container.width - size.width) / 2, y: (container.height - size.height) / 2, width: size.width, height: size.height)
    }
}
