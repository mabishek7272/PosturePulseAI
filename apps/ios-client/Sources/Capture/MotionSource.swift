import CoreMotion
import Foundation

/// Device gravity for the sidecar and the level check.
protocol MotionSource: AnyObject {
    func start()
    func stop()
    /// Latest CMDeviceMotion gravity in device coordinates; nil until the first
    /// reading (never invented).
    var latestGravity: [Double]? { get }
}

final class CoreMotionSource: MotionSource {
    private let manager = CMMotionManager()

    func start() {
        guard manager.isDeviceMotionAvailable, !manager.isDeviceMotionActive else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 60
        manager.startDeviceMotionUpdates()
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
    }

    var latestGravity: [Double]? {
        guard let g = manager.deviceMotion?.gravity else { return nil }
        return [g.x, g.y, g.z]
    }
}
