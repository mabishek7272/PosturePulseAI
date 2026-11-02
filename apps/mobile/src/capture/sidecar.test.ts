import type { GravitySample } from "./gravity";
import { buildSidecar, MissingGravityError } from "./sidecar";

const device = { model: "iPhone16,1", lens: "back_wide" as const, appVersion: "1.0.0" };

const base = {
  clipId: "clip-1",
  sessionId: "s-1",
  stepId: "static.anterior",
  view: "anterior",
  recordedAt: "2026-11-02T10:00:00.000Z",
  fps: 30,
  width: 1080,
  height: 1920,
  durationSeconds: 2,
  device,
};

describe("buildSidecar", () => {
  it("emits one frame per encoded frame, derived from real duration and fps", () => {
    const sidecar = buildSidecar({
      ...base,
      gravitySamples: [{ t: 0, g: [0, 1, 0] }, { t: 2, g: [0, 1, 0] }],
    });
    expect(sidecar.frames).toHaveLength(60);
    expect(sidecar.frames[0].index).toBe(0);
    expect(sidecar.frames[59].index).toBe(59);
  });

  it("interpolates gravity between samples", () => {
    const sidecar = buildSidecar({
      ...base, durationSeconds: 1, fps: 3,
      gravitySamples: [{ t: 0, g: [0, 1, 0] }, { t: 1, g: [1, 0, 0] }],
    });
    // Frame 1 is at t = 1/3, so the raw lerp is [0.3333, 0.6667, 0] — which is
    // then normalised to unit length, giving [0.4472, 0.8944, 0].
    const [x, y] = sidecar.frames[1].gravity;
    expect(x).toBeCloseTo(0.4472, 3);
    expect(y).toBeCloseTo(0.8944, 3);
  });

  it("returns unit vectors, because the schema specifies a unit gravity direction", () => {
    const sidecar = buildSidecar({
      ...base, durationSeconds: 1, fps: 2,
      gravitySamples: [{ t: 0, g: [0, 9.81, 0] }, { t: 1, g: [0, 9.81, 0] }],
    });
    for (const frame of sidecar.frames) {
      const [x, y, z] = frame.gravity;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
    }
  });

  it("holds the first and last samples rather than extrapolating past them", () => {
    const sidecar = buildSidecar({
      ...base, durationSeconds: 1, fps: 2,
      gravitySamples: [{ t: 0.4, g: [0, 1, 0] }, { t: 0.6, g: [0, 1, 0] }],
    });
    expect(sidecar.frames[0].gravity).toEqual([0, 1, 0]);
    expect(sidecar.frames[1].gravity).toEqual([0, 1, 0]);
  });

  it("throws rather than emitting zeros when no gravity was captured", () => {
    expect(() => buildSidecar({ ...base, gravitySamples: [] })).toThrow(MissingGravityError);
  });

  it("carries a provenance block with every required field", () => {
    const sidecar = buildSidecar({
      ...base, gravitySamples: [{ t: 0, g: [0, 1, 0] }, { t: 2, g: [0, 1, 0] }],
    });
    expect(sidecar.provenance.schemaVersion).toBe("clip-capture/v0");
    expect(sidecar.provenance.modelVersion).toContain("beaive-mobile");
    expect(sidecar.provenance.calibrationVersion).toBe("none/v0");
    expect(Number.isNaN(Date.parse(sidecar.provenance.producedAt))).toBe(false);
  });

  it("always produces at least one frame for a very short clip", () => {
    const sidecar = buildSidecar({
      ...base, durationSeconds: 0.01, fps: 30,
      gravitySamples: [{ t: 0, g: [0, 1, 0] }],
    });
    expect(sidecar.frames.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects a clip whose gravity samples cover only a fraction of the recording", () => {
    expect(() =>
      buildSidecar({
        ...base, durationSeconds: 3, fps: 30,
        gravitySamples: [{ t: 0, g: [0, 1, 0] }, { t: 0.2, g: [0, 1, 0] }],
      })
    ).toThrow(MissingGravityError);
  });

  it("interpolates correctly even when samples arrive out of order", () => {
    // Date.now() can step backwards under an NTP adjustment, so arrival order is
    // not guaranteed to be time order. Three samples, with the middle timestamp
    // arriving last, so the coverage guard passes unsorted and only the
    // interpolation can catch the ordering bug.
    const samples: GravitySample[] = [
      { t: 0, g: [0, 1, 0] },
      { t: 1, g: [0, 0, 1] },
      { t: 2, g: [1, 0, 0] },
    ];
    const shuffled = buildSidecar({
      ...base, durationSeconds: 2, fps: 2,
      gravitySamples: [samples[0], samples[2], samples[1]],
    });
    const inOrder = buildSidecar({
      ...base, durationSeconds: 2, fps: 2,
      gravitySamples: [...samples],
    });
    expect(shuffled.frames.map((f) => f.gravity)).toEqual(inOrder.frames.map((f) => f.gravity));
  });

  it("refuses to build a sidecar when the recording length is unknown", () => {
    for (const durationSeconds of [0, Number.NaN]) {
      expect(() =>
        buildSidecar({ ...base, durationSeconds, gravitySamples: [{ t: 0, g: [0, 1, 0] }] })
      ).toThrow(MissingGravityError);
    }
  });
});
