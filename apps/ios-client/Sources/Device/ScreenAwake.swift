import UIKit

@MainActor
protocol IdleTimerControlling: AnyObject {
    var isIdleTimerDisabled: Bool { get set }
}

extension UIApplication: IdleTimerControlling {}

/// Keeps the screen from auto-locking while a clip is being recorded - the iOS
/// counterpart of "do not let battery saving interrupt the session". Holds
/// nest; the original auto-lock setting is restored when the last hold ends.
@MainActor
final class ScreenAwake {
    static let shared = ScreenAwake(controller: UIApplication.shared)

    private let controller: IdleTimerControlling
    private var holds = 0
    private var previous = false

    init(controller: IdleTimerControlling) {
        self.controller = controller
    }

    func hold() {
        if holds == 0 { previous = controller.isIdleTimerDisabled }
        holds += 1
        controller.isIdleTimerDisabled = true
    }

    func release() {
        guard holds > 0 else { return }
        holds -= 1
        if holds == 0 { controller.isIdleTimerDisabled = previous }
    }
}
