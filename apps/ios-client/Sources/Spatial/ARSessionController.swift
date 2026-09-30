import ARKit
import Foundation

/// Wraps ARWorldTrackingConfiguration and publishes T_WC(t) per frame -
/// establishing the camera-pose.schema.json records this app streams via
/// CameraPoseStreamingClient. NOT verified in this sandbox (no Swift
/// toolchain - see apps/ios-client/README.md).
///
/// Mints a new `worldAnchorId` on re-anchor: whenever tracking recovers from
/// `.limited`/`.notAvailable` back to `.normal` (TRD 2.1's "re-anchor and
/// segment the time series when localization changes" rule -
/// docs/coordinate-frames.md). Records under different worldAnchorId values
/// must never be pooled as metrically comparable.
final class ARSessionController: NSObject {
    private let session = ARSession()
    private var currentWorldAnchorId = UUID().uuidString
    private var lastTrackingState: TrackingBucket = .notAvailable

    var onCameraPose: ((CameraPose) -> Void)?

    /// Fires on every tracking-bucket change (true = limited/notAvailable,
    /// false = normal) so the caller can show/hide TwoDFallbackBanner. Not a
    /// sustained/debounced signal - the caller decides how to react to
    /// transient flicker if that matters for its UI.
    var onTrackingDegraded: ((Bool) -> Void)?

    /// Capability check only - callers use this before start() to decide
    /// whether to show TwoDFallbackBanner.unsupportedDevice instead of
    /// attempting AR at all.
    static var isWorldTrackingSupported: Bool {
        ARWorldTrackingConfiguration.isSupported
    }

    private enum TrackingBucket {
        case normal, limited, notAvailable
    }

    func start() {
        guard ARWorldTrackingConfiguration.isSupported else {
            // 2D fallback mode (TRD 2.3) - the caller must show
            // TwoDFallbackBanner and never claim AR-anchored measurement.
            return
        }
        let configuration = ARWorldTrackingConfiguration()
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
            configuration.sceneReconstruction = .mesh
        }
        session.delegate = self
        session.run(configuration)
    }

    func stop() {
        session.pause()
    }

    private func trackingBucket(for state: ARCamera.TrackingState) -> TrackingBucket {
        switch state {
        case .normal: return .normal
        case .limited: return .limited
        case .notAvailable: return .notAvailable
        }
    }

    private func schemaTrackingState(for bucket: TrackingBucket) -> CameraPose.TrackingState {
        switch bucket {
        case .normal: return .normal
        case .limited: return .limited
        case .notAvailable: return .notAvailable
        }
    }

    /// ARKit does not expose a literal numeric confidence on ARCamera - this
    /// is a documented heuristic proxy, not a measured value.
    private func anchorConfidence(for bucket: TrackingBucket) -> Double {
        switch bucket {
        case .normal: return 1.0
        case .limited: return 0.5
        case .notAvailable: return 0.0
        }
    }
}

extension ARSessionController: ARSessionDelegate {
    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        let bucket = trackingBucket(for: frame.camera.trackingState)

        // Recovery from limited/notAvailable back to normal - mint a new
        // world-anchor segment rather than silently continuing the old one.
        if bucket == .normal && lastTrackingState != .normal {
            currentWorldAnchorId = UUID().uuidString
        }
        if bucket != lastTrackingState {
            onTrackingDegraded?(bucket != .normal)
        }
        lastTrackingState = bucket

        let transform = frame.camera.transform // 4x4, column-major
        let translation = [Double(transform.columns.3.x), Double(transform.columns.3.y), Double(transform.columns.3.z)]
        let rotation = quaternion(from: transform)

        let pose = CameraPose(
            timestamp: ISO8601DateFormatter().string(from: Date()),
            translation: translation,
            rotation: rotation,
            anchorConfidence: anchorConfidence(for: bucket),
            trackingState: schemaTrackingState(for: bucket),
            worldAnchorId: currentWorldAnchorId
        )
        onCameraPose?(pose)
    }

    private func quaternion(from transform: simd_float4x4) -> [Double] {
        let q = simd_quaternion(transform)
        return [Double(q.vector.x), Double(q.vector.y), Double(q.vector.z), Double(q.vector.w)]
    }
}
