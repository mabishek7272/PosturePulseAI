import XCTest
@testable import PostureAnalysisClient

@MainActor
private final class FakeIdleTimer: IdleTimerControlling { var isIdleTimerDisabled = false }

private final class FakeTorch: TorchControlling {
    var torchAvailable = true
    var accept = true
    var calls: [Bool] = []
    func setTorch(on: Bool) -> Bool { calls.append(on); return accept }
}

@MainActor
final class ScreenAwakeTests: XCTestCase {
    func testHoldDisablesAutoLockAndReleaseRestores() {
        let timer = FakeIdleTimer()
        let awake = ScreenAwake(controller: timer)
        awake.hold()
        XCTAssertTrue(timer.isIdleTimerDisabled)
        awake.release()
        XCTAssertFalse(timer.isIdleTimerDisabled)
    }

    func testNestedHoldsNeedMatchingReleases() {
        let timer = FakeIdleTimer()
        let awake = ScreenAwake(controller: timer)
        awake.hold(); awake.hold()
        awake.release()
        XCTAssertTrue(timer.isIdleTimerDisabled)
        awake.release()
        XCTAssertFalse(timer.isIdleTimerDisabled)
    }

    func testReleaseWithoutHoldIsHarmless() {
        let timer = FakeIdleTimer()
        let awake = ScreenAwake(controller: timer)
        awake.release()
        XCTAssertFalse(timer.isIdleTimerDisabled)
    }

    func testKeepsAutoLockOffIfSomethingElseHadItOff() {
        let timer = FakeIdleTimer()
        timer.isIdleTimerDisabled = true
        let awake = ScreenAwake(controller: timer)
        awake.hold(); awake.release()
        XCTAssertTrue(timer.isIdleTimerDisabled)
    }
}

@MainActor
final class TorchSwitchTests: XCTestCase {
    func testToggleTurnsLightOnAndOff() {
        let torch = FakeTorch()
        let sw = TorchSwitch(torch: torch)
        sw.toggle()
        XCTAssertTrue(sw.isOn)
        sw.toggle()
        XCTAssertFalse(sw.isOn)
        XCTAssertEqual(torch.calls, [true, false])
    }

    func testRefusedLightStaysOffAndExplains() {
        let torch = FakeTorch(); torch.accept = false
        let sw = TorchSwitch(torch: torch)
        sw.toggle()
        XCTAssertFalse(sw.isOn)
        XCTAssertNotNil(sw.message)
    }

    func testTurnOffOnlyActsWhenOn() {
        let torch = FakeTorch()
        let sw = TorchSwitch(torch: torch)
        sw.turnOff()
        XCTAssertTrue(torch.calls.isEmpty)
        sw.toggle(); sw.turnOff()
        XCTAssertFalse(sw.isOn)
        XCTAssertEqual(torch.calls, [true, false])
    }

    func testAvailabilityMirrorsTheCamera() {
        let torch = FakeTorch(); torch.torchAvailable = false
        XCTAssertFalse(TorchSwitch(torch: torch).isAvailable)
        torch.torchAvailable = true
        XCTAssertTrue(TorchSwitch(torch: torch).isAvailable)
    }
}
