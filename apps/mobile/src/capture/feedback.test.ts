import { createFeedback, ISSUE_TEXT, type FeedbackEvent, type Issue, type Phase } from "./feedback";

const set = (...i: Issue[]) => new Set<Issue>(i);
type Tick = [number, Issue[]];

/** Runs ticks every 100 ms from t0..t1 with a fixed issue set; returns [time, event] pairs. */
function run(fb: ReturnType<typeof createFeedback>, from: number, to: number, issues: Issue[], phase: Phase = "recording") {
  const out: Array<[number, FeedbackEvent]> = [];
  for (let t = from; t <= to; t += 100) for (const e of fb.step({ phase, issues: set(...issues), now: t })) out.push([t, e]);
  return out;
}
const kinds = (r: Array<[number, FeedbackEvent]>) => r.map(([, e]) => e.kind);

describe("feedback state machine", () => {
  it("emits exactly one start on the first recording tick", () => {
    const fb = createFeedback();
    const r = run(fb, 0, 2000, []);
    expect(kinds(r).filter((k) => k === "start")).toHaveLength(1);
    expect(r[0]![0]).toBe(0);
  });

  it("fires nothing during idle or countdown, and restarts after", () => {
    const fb = createFeedback();
    expect(run(fb, 0, 5000, ["steady"], "idle")).toEqual([]);
    expect(run(fb, 5100, 9000, ["steady", "tilt"], "countdown")).toEqual([]);
    expect(kinds(run(fb, 9100, 9100, []))).toEqual(["start"]);
    run(fb, 9200, 12000, []);
    expect(run(fb, 12100, 13000, [], "idle")).toEqual([]);
    expect(kinds(run(fb, 13100, 13100, []))).toEqual(["start"]);
  });

  it("never warns for a blip shorter than the hysteresis", () => {
    const fb = createFeedback();
    run(fb, 0, 500, []);
    const r = [...run(fb, 600, 1300, ["steady"]), ...run(fb, 1400, 3000, [])];
    expect(kinds(r)).not.toContain("warn");
    expect(kinds(r)).not.toContain("recovered");
  });

  it("warns once an issue has persisted 0.8 s", () => {
    const fb = createFeedback();
    run(fb, 0, 500, []);
    const r = run(fb, 600, 1600, ["steady"]);
    const warns = r.filter(([, e]) => e.kind === "warn");
    expect(warns).toEqual([[1400, { kind: "warn", issue: "steady" }]]);
    expect(fb.activeIssue()).toBe("steady");
  });

  it("throttles warnings globally to one per 3 s", () => {
    const fb = createFeedback();
    run(fb, 0, 100, []);
    const r = run(fb, 200, 2000, ["steady", "tilt"]);
    expect(r.filter(([, e]) => e.kind === "warn")).toEqual([[1000, { kind: "warn", issue: "tilt" }]]);
    const r2 = run(fb, 2100, 4200, ["steady", "tilt"]);
    // next allowed at 4000 and tilt is still within its 6 s repeat window, so steady speaks
    expect(r2.filter(([, e]) => e.kind === "warn")).toEqual([[4000, { kind: "warn", issue: "steady" }]]);
  });

  it("does not repeat the same issue more often than every 6 s", () => {
    const fb = createFeedback();
    run(fb, 0, 100, []);
    const r = run(fb, 200, 20000, ["steady"]);
    const times = r.filter(([, e]) => e.kind === "warn").map(([t]) => t);
    expect(times).toEqual([1000, 7000, 13000, 19000]);
  });

  it("recovers once after all issues clear, and not without a warning", () => {
    const fb = createFeedback();
    run(fb, 0, 100, []);
    expect(kinds(run(fb, 200, 2000, []))).not.toContain("recovered");
    run(fb, 2100, 3500, ["steady"]);
    const r = run(fb, 3600, 6000, []);
    expect(kinds(r)).toEqual(["recovered"]);
    expect(fb.activeIssue()).toBeNull();
  });

  it("limits recovered to once per 5 s", () => {
    const fb = createFeedback();
    run(fb, 0, 100, []);
    run(fb, 200, 1200, ["steady"]); // warns at 1000
    expect(kinds(run(fb, 1300, 1300, []))).toEqual(["recovered"]);
    // second cycle: issue returns, warns at >= 4000 (global throttle), clears at 4200
    run(fb, 1400, 4100, ["steady", "tilt"]);
    const r = run(fb, 4200, 4200, []);
    expect(kinds(r)).toEqual([]); // 4200 - 1300 < 5000
    expect(fb.activeIssue()).toBeNull();
  });

  it("fires milestones every 10 s of steady streak, 10 and 20 for a 30 s clip", () => {
    const fb = createFeedback(30);
    const r = run(fb, 0, 35000, []);
    expect(r.filter(([, e]) => e.kind === "milestone")).toEqual([
      [10000, { kind: "milestone", seconds: 10 }],
      [20000, { kind: "milestone", seconds: 20 }],
    ]);
  });

  it("restarts the streak when steadiness breaks", () => {
    const fb = createFeedback(30);
    run(fb, 0, 9000, []);
    run(fb, 9100, 9200, ["steady"]);
    const r = run(fb, 9300, 19000, []);
    expect(r.filter(([, e]) => e.kind === "milestone")).toEqual([]);
    const r2 = run(fb, 19100, 19400, []);
    expect(r2.filter(([, e]) => e.kind === "milestone")).toEqual([[19300, { kind: "milestone", seconds: 10 }]]);
  });

  it("a non-streak issue such as level does not reset milestones", () => {
    const fb = createFeedback(30);
    const r = run(fb, 0, 10000, ["level"]);
    expect(r.filter(([, e]) => e.kind === "milestone")).toHaveLength(1);
  });

  it("ends the streak when ticks stop arriving", () => {
    const fb = createFeedback(30);
    run(fb, 0, 8000, []);
    const r = run(fb, 9000, 10000, []); // 1 s gap
    expect(r.filter(([, e]) => e.kind === "milestone")).toEqual([]);
  });

  it("is deterministic for identical input", () => {
    const script: Tick[] = [];
    for (let t = 0; t <= 30000; t += 100) script.push([t, t % 7000 < 2500 ? ["steady"] : t % 11000 < 1500 ? ["tilt", "centred"] : []]);
    const play = () => {
      const fb = createFeedback();
      return script.flatMap(([t, i]) => fb.step({ phase: "recording", issues: set(...i), now: t }));
    };
    expect(play()).toEqual(play());
  });

  it("has plain text for every issue", () => {
    for (const t of Object.values(ISSUE_TEXT)) expect(t.length).toBeGreaterThan(3);
  });
});
