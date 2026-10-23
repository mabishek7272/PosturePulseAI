import AVFoundation
import Foundation

protocol TorchControlling: AnyObject {
    var torchAvailable: Bool { get }
    /// Returns false if the light could not be changed (unavailable, hot, camera busy).
    @discardableResult func setTorch(on: Bool) -> Bool
}

/// The flashlight switch shown while recording. Off by default; it must be
/// off again when leaving the capture screen.
@MainActor
final class TorchSwitch: ObservableObject {
    @Published private(set) var isOn = false
    @Published private(set) var message: String?
    private let torch: TorchControlling

    init(torch: TorchControlling) {
        self.torch = torch
    }

    var isAvailable: Bool { torch.torchAvailable }

    func toggle() {
        message = nil
        let target = !isOn
        if torch.setTorch(on: target) {
            isOn = target
        } else {
            if target { isOn = false }
            message = "The light is not available right now."
        }
    }

    func turnOff() {
        guard isOn else { return }
        _ = torch.setTorch(on: false)
        isOn = false
    }
}

extension ClipRecorder: TorchControlling {
    private var backDevice: AVCaptureDevice? {
        (session.inputs.first as? AVCaptureDeviceInput)?.device
    }

    var torchAvailable: Bool {
        guard let device = backDevice else { return false }
        return device.hasTorch && device.isTorchAvailable
    }

    func setTorch(on: Bool) -> Bool {
        guard let device = backDevice, device.hasTorch else { return false }
        do {
            try device.lockForConfiguration()
            defer { device.unlockForConfiguration() }
            if on {
                guard device.isTorchAvailable else { return false }
                try device.setTorchModeOn(level: 0.6)
            } else {
                device.torchMode = .off
            }
            return true
        } catch {
            return false
        }
    }
}
