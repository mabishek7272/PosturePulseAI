import SwiftUI

/// Draws the on-device guidance pose as a plain stick figure over the
/// letterboxed camera preview, so the person can see they are framed. Lines
/// only: no angles, no numbers, no colours that suggest good or bad.
struct SkeletonOverlay: View {
    let pose: BodyPose2D?
    /// Oriented camera frame size, to place the letterboxed image.
    let imageSize: CGSize

    private static let bones: [(BodyPose2D.Joint, BodyPose2D.Joint)] = [
        (.leftShoulder, .rightShoulder), (.leftHip, .rightHip),
        (.leftShoulder, .leftHip), (.rightShoulder, .rightHip),
        (.leftHip, .leftKnee), (.leftKnee, .leftAnkle),
        (.rightHip, .rightKnee), (.rightKnee, .rightAnkle),
        (.leftEar, .leftShoulder), (.rightEar, .rightShoulder),
    ]

    var body: some View {
        GeometryReader { geo in
            let rect = Self.fittedRect(image: imageSize, in: geo.size)
            Canvas { context, _ in
                guard let pose else { return }
                func point(_ joint: BodyPose2D.Joint) -> CGPoint? {
                    guard let p = pose.joints[joint], p.confidence >= 0.3 else { return nil }
                    return CGPoint(x: rect.minX + p.x * rect.width, y: rect.minY + p.y * rect.height)
                }
                var path = Path()
                for (a, b) in Self.bones {
                    if let pa = point(a), let pb = point(b) {
                        path.move(to: pa)
                        path.addLine(to: pb)
                    }
                }
                context.stroke(path, with: .color(Theme.readoutText.opacity(0.8)), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                for joint in BodyPose2D.Joint.allCases {
                    if let p = point(joint) {
                        context.fill(Path(ellipseIn: CGRect(x: p.x - 4, y: p.y - 4, width: 8, height: 8)), with: .color(Theme.readoutText))
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
