import CoreVideo
import Foundation
import Vision

/// On-device 2D pose for guidance only (framing, view, stillness). Never
/// uploaded and never shown as a number.
protocol PoseDetecting: AnyObject {
    func detect(in pixelBuffer: CVPixelBuffer) -> BodyPose2D?
}

/// Vision joint names -> guidance joints, and Vision's normalised
/// bottom-left-origin points -> top-left-origin image coordinates. Vision
/// names joints by the person's own left and right.
enum VisionJointMapping {
    static let visionNames: [BodyPose2D.Joint: VNHumanBodyPoseObservation.JointName] = [
        .nose: .nose,
        .leftEar: .leftEar,
        .rightEar: .rightEar,
        .leftShoulder: .leftShoulder,
        .rightShoulder: .rightShoulder,
        .leftHip: .leftHip,
        .rightHip: .rightHip,
        .leftKnee: .leftKnee,
        .rightKnee: .rightKnee,
        .leftAnkle: .leftAnkle,
        .rightAnkle: .rightAnkle,
    ]

    static func point(x: Double, y: Double, confidence: Double) -> BodyPose2D.Point {
        BodyPose2D.Point(x: x, y: 1 - y, confidence: confidence)
    }

    /// `raw` in Vision coordinates; joints Vision did not detect (confidence 0) are left out.
    static func pose(from raw: [BodyPose2D.Joint: (x: Double, y: Double, confidence: Double)]) -> BodyPose2D {
        var joints: [BodyPose2D.Joint: BodyPose2D.Point] = [:]
        for (joint, p) in raw where p.confidence > 0 {
            joints[joint] = point(x: p.x, y: p.y, confidence: p.confidence)
        }
        return BodyPose2D(joints: joints)
    }
}

final class VisionPoseDetector: PoseDetecting {
    private let request = VNDetectHumanBodyPoseRequest()

    /// The pixel buffer is already upright (the recorder rotates frames).
    func detect(in pixelBuffer: CVPixelBuffer) -> BodyPose2D? {
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up)
        do {
            try handler.perform([request])
        } catch {
            return nil
        }
        // The most confident person in view.
        let observation = request.results?.max { a, b in a.confidence < b.confidence }
        guard let observation, let points = try? observation.recognizedPoints(.all) else { return nil }
        var raw: [BodyPose2D.Joint: (x: Double, y: Double, confidence: Double)] = [:]
        for (joint, name) in VisionJointMapping.visionNames {
            if let p = points[name] {
                raw[joint] = (Double(p.location.x), Double(p.location.y), Double(p.confidence))
            }
        }
        return VisionJointMapping.pose(from: raw)
    }
}
