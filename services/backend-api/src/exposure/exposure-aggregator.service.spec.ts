import { ExposureAggregatorService } from "./exposure-aggregator.service";

function buildAggregator() {
  const events = { appendValidated: jest.fn().mockResolvedValue(undefined) };
  const gateway = { broadcast: jest.fn() };
  const aggregator = new ExposureAggregatorService(events as never, gateway as never);
  return { aggregator, events, gateway };
}

describe("ExposureAggregatorService", () => {
  it("does not start a window when there is nothing to classify", async () => {
    const { aggregator, events } = buildAggregator();
    const result = await aggregator.recordFrame("s1", null, true, new Date(), { type: "quality-gate-flag", refId: "f1" });
    expect(result).toBeNull();
    expect(events.appendValidated).not.toHaveBeenCalled();
  });

  it("flushes and starts a new window on bucket change, excluding no valid time from an all-unsupported window", async () => {
    const { aggregator, events } = buildAggregator();
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:00:02Z");

    await aggregator.recordFrame("s1", "neutral", false, t0, { type: "quality-gate-flag", refId: "f0" });
    // 2 seconds elapsed in the "neutral" window, quality unsupported throughout.
    const flushed = await aggregator.recordFrame("s1", "forward_flexion_mild", false, t1, {
      type: "quality-gate-flag",
      refId: "f1",
    });

    expect(flushed).toMatchObject({ postureBucket: "neutral", validSeconds: 0, totalWindowSeconds: 2 });
    expect(events.appendValidated).toHaveBeenCalledWith("s1", "exposure-event", expect.objectContaining({ postureBucket: "neutral" }));
  });

  it("accrues validSeconds only while quality is supported", async () => {
    const { aggregator } = buildAggregator();
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:00:03Z"); // supported
    const t2 = new Date("2026-01-01T00:00:05Z"); // unsupported (2s)

    await aggregator.recordFrame("s1", "neutral", true, t0, { type: "quality-gate-flag", refId: "f0" });
    await aggregator.recordFrame("s1", "neutral", true, t1, { type: "quality-gate-flag", refId: "f1" }); // +3s valid
    await aggregator.recordFrame("s1", "neutral", false, t2, { type: "quality-gate-flag", refId: "f2" }); // +2s total, not valid
    const flushed = await aggregator.recordFrame("s1", "forward_flexion_severe", true, new Date(t2.getTime() + 1000), {
      type: "quality-gate-flag",
      refId: "f3",
    });

    // The final 1s interval (t2 -> transition frame) is attributed to the
    // "neutral" window using the transition frame's own quality (true) - see
    // the aggregator's accrue-before-flush comment.
    expect(flushed).toMatchObject({ postureBucket: "neutral", validSeconds: 4, totalWindowSeconds: 6 });
  });

  it("flushes automatically once the window reaches the max length, then continues the same bucket", async () => {
    const { aggregator } = buildAggregator();
    let t = new Date("2026-01-01T00:00:00Z").getTime();

    await aggregator.recordFrame("s1", "neutral", true, new Date(t), { type: "quality-gate-flag", refId: "f0" });
    let flushed: unknown = null;
    for (let i = 0; i < 15; i++) {
      t += 5000; // 5s per step, 15 steps = 75s > MAX_WINDOW_SECONDS (60)
      flushed = await aggregator.recordFrame("s1", "neutral", true, new Date(t), { type: "quality-gate-flag", refId: `f${i}` });
      if (flushed) break;
    }

    expect(flushed).not.toBeNull();
    expect((flushed as { totalWindowSeconds: number }).totalWindowSeconds).toBeGreaterThanOrEqual(60);
  });

  it("caps a single frame gap so a long pause is not counted as real exposure time", async () => {
    const { aggregator } = buildAggregator();
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:10:00Z"); // 10 minute gap - must be capped

    await aggregator.recordFrame("s1", "neutral", true, t0, { type: "quality-gate-flag", refId: "f0" });
    const flushed = await aggregator.recordFrame("s1", "forward_flexion_mild", true, t1, {
      type: "quality-gate-flag",
      refId: "f1",
    });

    expect((flushed as { totalWindowSeconds: number }).totalWindowSeconds).toBeLessThanOrEqual(5);
  });
});
