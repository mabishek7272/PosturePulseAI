import Foundation

enum CameraAccess: Equatable {
    case notDetermined, allowed, denied, restricted
}

/// What this device can do right now. The real implementation reads iOS
/// (SystemDeviceCapabilities); tests use a fake.
protocol DeviceCapabilities {
    var cameraAccess: CameraAccess { get }
    var hasTorch: Bool { get }
    /// TrueDepth (infrared) camera or LiDAR scanner present. Needs no permission of its own.
    var hasDepthSensor: Bool { get }
    var isLowPowerModeEnabled: Bool { get }
    var thermalState: ProcessInfo.ThermalState { get }
}

struct ReadinessItem: Identifiable, Equatable {
    enum Status: Equatable { case ready, info, warning, needsAction }
    let id: String
    let title: String
    let detail: String
    let status: Status
    let action: DeviceReadiness.Action
}

/// The device check shown before an assessment. Only the camera can block
/// recording; Low Power Mode and heat are warnings; the flashlight and depth
/// sensor are information. Nothing here is a health statement.
struct DeviceReadiness: Equatable {
    enum Action: Equatable { case none, allowCamera, openSettings }

    let items: [ReadinessItem]

    var canRecord: Bool { items.first { $0.id == "camera" }?.status == .ready }
    var hasWarnings: Bool { items.contains { $0.status == .warning } }

    init(_ caps: DeviceCapabilities) {
        var list: [ReadinessItem] = []

        switch caps.cameraAccess {
        case .allowed:
            list.append(.init(id: "camera", title: "Camera", detail: "Allowed. Used to record each step.", status: .ready, action: .none))
        case .notDetermined:
            list.append(.init(id: "camera", title: "Camera", detail: "Needed to record your assessment. Tap Allow, then choose OK.", status: .needsAction, action: .allowCamera))
        case .denied:
            list.append(.init(id: "camera", title: "Camera", detail: "Camera access is off. Turn it on for PosturePulse in Settings.", status: .needsAction, action: .openSettings))
        case .restricted:
            list.append(.init(id: "camera", title: "Camera", detail: "Camera use is restricted on this device (for example by Screen Time or device management).", status: .needsAction, action: .none))
        }

        list.append(caps.hasTorch
            ? .init(id: "flashlight", title: "Flashlight", detail: "Available. A light switch appears while you record; use it only in a dim room.", status: .ready, action: .none)
            : .init(id: "flashlight", title: "Flashlight", detail: "This device has no flashlight. It is not needed.", status: .info, action: .none))

        list.append(caps.hasDepthSensor
            ? .init(id: "depth", title: "Infrared depth sensor", detail: "Present (TrueDepth or LiDAR). It uses the camera permission and is not used by this version.", status: .info, action: .none)
            : .init(id: "depth", title: "Infrared depth sensor", detail: "This device has none. It is not needed.", status: .info, action: .none))

        list.append(.init(id: "awake", title: "Screen stays on", detail: "The screen will not lock while you record.", status: .ready, action: .none))

        list.append(caps.isLowPowerModeEnabled
            ? .init(id: "power", title: "Low Power Mode", detail: "On. It can lower the camera frame rate. Turn it off in Settings > Battery before you record.", status: .warning, action: .openSettings)
            : .init(id: "power", title: "Low Power Mode", detail: "Off.", status: .ready, action: .none))

        if caps.thermalState == .serious || caps.thermalState == .critical {
            list.append(.init(id: "thermal", title: "Device temperature", detail: "This device is hot and may slow the camera. Let it cool, out of the sun, before you record.", status: .warning, action: .none))
        }

        items = list
    }
}
