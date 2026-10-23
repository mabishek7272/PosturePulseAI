import Foundation

/// How the recorded frames are oriented relative to the device. The clip
/// recorder physically rotates buffers to this orientation, so the encoded
/// frames are upright and carry no rotation metadata (the server decodes raw
/// frames). Names follow AVCaptureVideoOrientation: `landscapeRight` = home
/// button / USB-C port on the right.
enum ClipOrientation: String, CaseIterable {
    case portrait
    case portraitUpsideDown
    case landscapeRight
    case landscapeLeft
}

/// Gravity conversion for the clip sidecar (clip-capture.schema.json).
///
/// Device frame D (CoreMotion): x = right edge in portrait, y = top edge,
/// z = out of the screen toward the person holding it.
/// Camera frame C of the oriented back-camera image: x = image right,
/// y = image down, z = optical axis, away from the camera (= -z device).
/// The back camera is not mirrored.
enum CameraGravity {
    static func normalised(_ v: [Double]) -> [Double]? {
        guard v.count == 3 else { return nil }
        let n = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).squareRoot()
        guard n > 1e-9, n.isFinite else { return nil }
        return v.map { $0 / n }
    }

    /// Unit gravity in C. A level phone filming upright yields [0, 1, 0] in every
    /// orientation. Returns [0, 0, 0] only if the input is degenerate; callers
    /// should check `normalised` first (a missing reading is never invented).
    static func cameraFrame(deviceGravity g: [Double], orientation: ClipOrientation) -> [Double] {
        guard g.count == 3 else { return [0, 0, 0] }
        let (gx, gy, gz) = (g[0], g[1], g[2])
        let c: [Double]
        switch orientation {
        case .portrait:
            // image right = +x D, image down = -y D
            c = [gx, -gy, -gz]
        case .portraitUpsideDown:
            // image right = -x D, image down = +y D
            c = [-gx, gy, -gz]
        case .landscapeRight:
            // top edge points left, right edge points up:
            // image right = -y D, image down = -x D
            c = [-gy, -gx, -gz]
        case .landscapeLeft:
            // top edge points right, right edge points down:
            // image right = +y D, image down = +x D
            c = [gy, gx, -gz]
        }
        return normalised(c) ?? [0, 0, 0]
    }

    /// In-plane tilt of the image against true vertical, degrees. Positive when
    /// gravity leans toward image right.
    static func rollDegrees(_ c: [Double]) -> Double {
        guard c.count == 3 else { return .nan }
        return atan2(c[0], c[1]) * 180 / .pi
    }

    /// Tilt of the optical axis out of the horizontal plane, degrees (unsigned),
    /// as the analysis computes it: asin(|g_z|).
    static func pitchDegrees(_ c: [Double]) -> Double {
        guard c.count == 3 else { return .nan }
        return asin(min(abs(c[2]), 1)) * 180 / .pi
    }
}
