import { BatteryService } from "../battery/battery.service";
import { StepsService } from "./steps.service";

const battery = new BatteryService();
const at = (s: number) => new Date(Date.UTC(2026, 9, 23, 10, 0, s));

const estimate = (clipId: string, stepId: string, metricKey: string) => ({
  clipId,
  stepId,
  metricKey,
  side: null,
  estimate: { value: 1, uncertainty: 0.5, framesUsed: 100 },
});
const unsupported = (clipId: string, stepId: string, metricKey: string, reasons: string[]) => ({
  clipId,
  stepId,
  metricKey,
  side: null,
  unsupported: { reasons },
});

function build(clips: unknown[], results: unknown[]) {
  const prisma = { clip: { findMany: jest.fn().mockResolvedValue(clips) } };
  const events = {
    listForSessionByType: jest
      .fn()
      .mockResolvedValue(results.map((payload, i) => ({ payload, createdAt: at(i) }))),
  };
  return { service: new StepsService(prisma as never, events as never, battery), prisma, events };
}

const keysOf = (stepId: string) => battery.step(stepId)!.metricKeys;

describe("StepsService.statusFor", () => {
  it("lists every battery step, in battery order, as missing when nothing was uploaded", async () => {
    const { service } = build([], []);
    const steps = await service.statusFor("s1");
    expect(steps.map((s) => s.stepId)).toEqual(battery.battery.steps.map((s) => s.stepId));
    expect(steps.every((s) => s.status === "missing" && s.usable === false && s.reasons.length === 0)).toBe(true);
  });

  it("reports processing while the newest clip is uploaded", async () => {
    const { service } = build([{ id: "c1", stepId: "static.anterior", status: "uploaded", createdAt: at(1) }], []);
    const step = (await service.statusFor("s1")).find((s) => s.stepId === "static.anterior")!;
    expect(step).toMatchObject({ status: "processing", usable: false, reasons: [] });
  });

  it("reports analyzed and usable when every metric has an estimate", async () => {
    const results = keysOf("static.posterior").map((k) => estimate("c1", "static.posterior", k));
    const { service } = build([{ id: "c1", stepId: "static.posterior", status: "analyzed", createdAt: at(1) }], results);
    const step = (await service.statusFor("s1")).find((s) => s.stepId === "static.posterior")!;
    expect(step).toMatchObject({ status: "analyzed", usable: true, reasons: [] });
  });

  it("reports analyzed but not usable, with the distinct reasons, when results are unsupported", async () => {
    const keys = keysOf("static.anterior");
    const results = [
      unsupported("c1", "static.anterior", keys[0], ["out_of_frame", "occlusion"]),
      unsupported("c1", "static.anterior", keys[1], ["out_of_frame"]),
      estimate("c1", "static.anterior", keys[2]),
    ];
    const { service } = build([{ id: "c1", stepId: "static.anterior", status: "analyzed", createdAt: at(1) }], results);
    const step = (await service.statusFor("s1")).find((s) => s.stepId === "static.anterior")!;
    expect(step.status).toBe("analyzed");
    expect(step.usable).toBe(false);
    expect(step.reasons).toEqual(["out_of_frame", "occlusion"]);
  });

  it("is not usable when an analysed clip has fewer results than the step has metrics", async () => {
    const { service } = build(
      [{ id: "c1", stepId: "static.posterior", status: "analyzed", createdAt: at(1) }],
      [estimate("c1", "static.posterior", keysOf("static.posterior")[0])]
    );
    const step = (await service.statusFor("s1")).find((s) => s.stepId === "static.posterior")!;
    expect(step).toMatchObject({ status: "analyzed", usable: false });
  });

  it("reports failed when the newest clip failed analysis", async () => {
    const { service } = build([{ id: "c1", stepId: "static.anterior", status: "failed", createdAt: at(1) }], []);
    const step = (await service.statusFor("s1")).find((s) => s.stepId === "static.anterior")!;
    expect(step).toMatchObject({ status: "failed", usable: false, reasons: [] });
  });

  it("lets the newest clip decide, and only counts results of that clip (a re-upload is processing again)", async () => {
    const results = keysOf("static.posterior").map((k) => estimate("c1", "static.posterior", k));
    const { service } = build(
      [
        { id: "c1", stepId: "static.posterior", status: "analyzed", createdAt: at(1) },
        { id: "c2", stepId: "static.posterior", status: "uploaded", createdAt: at(5) },
      ],
      results
    );
    const step = (await service.statusFor("s1")).find((s) => s.stepId === "static.posterior")!;
    expect(step).toMatchObject({ status: "processing", usable: false });
  });

  it("ignores discarded clips", async () => {
    const { service } = build([{ id: "c1", stepId: "static.anterior", status: "discarded", createdAt: at(1) }], []);
    const step = (await service.statusFor("s1")).find((s) => s.stepId === "static.anterior")!;
    expect(step.status).toBe("missing");
  });

  it("uses the newest result per metric when an analysis was retried", async () => {
    const keys = keysOf("static.posterior");
    const results = [
      ...keys.map((k) => unsupported("c1", "static.posterior", k, ["occlusion"])),
      ...keys.map((k) => estimate("c1", "static.posterior", k)),
    ];
    const { service } = build([{ id: "c1", stepId: "static.posterior", status: "analyzed", createdAt: at(1) }], results);
    const step = (await service.statusFor("s1")).find((s) => s.stepId === "static.posterior")!;
    expect(step).toMatchObject({ usable: true, reasons: [] });
  });
});
