import AVFoundation
import UIKit

/// Reads the real device. Camera permission is the only access this app asks
/// for: the flashlight and any infrared/depth sensor are part of the camera and
/// have no separate iOS permission; screen-lock and battery behaviour are
/// handled by ScreenAwake and the Low Power Mode notice (iOS has no per-app
/// "battery optimisation" switch).
struct SystemDeviceCapabilities: DeviceCapabilities {
    var cameraAccess: CameraAccess {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return .allowed
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        case .restricted: return .restricted
        @unknown default: return .denied
        }
    }

    var hasTorch: Bool {
        AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)?.hasTorch ?? false
    }

    var hasDepthSensor: Bool {
        !AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInLiDARDepthCamera, .builtInTrueDepthCamera],
            mediaType: .video,
            position: .unspecified
        ).devices.isEmpty
    }

    var isLowPowerModeEnabled: Bool { ProcessInfo.processInfo.isLowPowerModeEnabled }
    var thermalState: ProcessInfo.ThermalState { ProcessInfo.processInfo.thermalState }

    static func requestCameraAccess() async -> Bool {
        await AVCaptureDevice.requestAccess(for: .video)
    }

    @MainActor
    static func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }
}
