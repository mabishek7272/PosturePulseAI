import { IDLE_LOCK_MS, isIdle, recordActivity, resetIdleLockForTests } from "./idleLock";

describe("idleLock", () => {
  beforeEach(() => {
    resetIdleLockForTests();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("is not idle immediately after activity is recorded", () => {
    recordActivity();
    expect(isIdle()).toBe(false);
  });

  it("becomes idle once the threshold elapses with no activity", () => {
    recordActivity();
    jest.advanceTimersByTime(IDLE_LOCK_MS + 1);
    expect(isIdle()).toBe(true);
  });

  it("resets the clock on new activity", () => {
    recordActivity();
    jest.advanceTimersByTime(IDLE_LOCK_MS - 1000);
    recordActivity();
    jest.advanceTimersByTime(2000);
    expect(isIdle()).toBe(false);
  });

  it("treats no recorded activity yet as not idle", () => {
    // Avoids locking the instant the app opens, before any touch has happened.
    expect(isIdle()).toBe(false);
  });
});
