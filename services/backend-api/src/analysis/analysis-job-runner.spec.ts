import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BatteryService } from "../battery/battery.service";
import { AnalysisJobRunner, MAX_ATTEMPTS } from "./analysis-job-runner";

const battery = new BatteryService();
const STEP = battery.step("static.posterior")!;

const provenance = {
  schemaVersion: "metric-result/v0",
  modelVersion: "mediapipe-pose-full/0.10.14",
  calibrationVersion: "none/v0",
  producedAt: "2026-10-23T10:00:00Z",
  metricsVersion: "metrics/v1",
};

function estimateResult(metricKey: string, extra: Record<string, unknown> = {}) {
  return {
    resultId: `r-${metricKey}`,
    sessionId: "s1",
    clipId: "c1",
    stepId: "static.posterior",
    metricKey,
    module: "static",
    tier: "estimate",
    unit: "deg",
    side: null,
    estimate: { value: 1.2, uncertainty: 0.4, framesUsed: 120 },
    provenance,
    ...extra,
  };
}

const okResponse = () => ({
  results: STEP.metricKeys.map((k) => estimateResult(k)),
  landmarkSeries: { path: "/data/clips/landmarks/c1.json.gz", sha256: "a".repeat(64) },
  frameQuality: { usable: 120, total: 130, reasons: [] },
});

function setup(
  options: { scopes?: string[]; analyze?: jest.Mock; claimed?: unknown[]; attempts?: number; depth?: boolean } = {}
) {
  const dir = mkdtempSync(path.join(tmpdir(), "runner-"));
  const clipFile = path.join(dir, "c1.mov");
  writeFileSync(clipFile, "video");
  // null, not undefined, so the mock matches what Prisma returns for a clip
  // uploaded without a depth track.
  let depthFile: string | null = null;
  if (options.depth) {
    depthFile = path.join(dir, "c1.depth");
    writeFileSync(depthFile, "depth");
  }
  const claims = [...(options.claimed ?? [{ id: "j1", clipId: "c1", attempts: options.attempts ?? 1 }])];
  const prisma = {
    $queryRaw: jest.fn().mockImplementation(() => Promise.resolve(claims.length ? [claims.shift()] : [])),
    $executeRaw: jest.fn().mockResolvedValue(0),
    clip: {
      findUnique: jest.fn().mockResolvedValue({
        id: "c1",
        sessionId: "s1",
        stepId: "static.posterior",
        path: clipFile,
        depthPath: depthFile,
        sidecar: { clipId: "c1" },
        status: "uploaded",
      }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    analysisJob: { update: jest.fn().mockResolvedValue({}) },
    session: { findUnique: jest.fn().mockResolvedValue({ id: "s1", consentRecordId: "consent1" }) },
    $transaction: jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
  };
  const ml = { analyzeClip: options.analyze ?? jest.fn().mockResolvedValue(okResponse()) };
  const events = { appendValidated: jest.fn().mockResolvedValue({}) };
  const consent = {
    hasActiveScope: jest.fn().mockImplementation((_id: string, scope: string) => Promise.resolve((options.scopes ?? []).includes(scope))),
  };
  const runner = new AnalysisJobRunner(prisma as never, ml as never, events as never, battery, consent as never, 2, 1000);
  return { runner, prisma, ml, events, consent, clipFile, depthFile };
}

describe("AnalysisJobRunner.claimNext", () => {
  it("claims one pending job with FOR UPDATE SKIP LOCKED in a single UPDATE", async () => {
    const { runner, prisma } = setup();
    const job = await runner.claimNext();
    expect(job).toEqual({ id: "j1", clipId: "c1", attempts: 1 });
    const strings = (prisma.$queryRaw.mock.calls[0][0] as readonly string[]).join("?");
    expect(strings).toMatch(/UPDATE "AnalysisJob"/);
    expect(strings).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(strings).toMatch(/LIMIT 1/);
    expect(strings).toMatch(/status = 'running'/);
    expect(strings).toMatch(/attempts = "?attempts"? \+ 1/);
    expect(strings).toMatch(/INTERVAL '15 minutes'/);
  });

  it("returns null when nothing is pending", async () => {
    const { runner } = setup({ claimed: [] });
    await expect(runner.claimNext()).resolves.toBeNull();
  });
});

describe("AnalysisJobRunner.process", () => {
  it("sends the step's metric keys and capture limits to ml-service", async () => {
    const { runner, ml } = setup();
    await runner.process({ id: "j1", clipId: "c1", attempts: 1 });
    expect(ml.analyzeClip).toHaveBeenCalledWith({
      sessionId: "s1",
      clipId: "c1",
      stepId: "static.posterior",
      clipPath: expect.stringMatching(/c1\.mov$/),
      // Part of the request contract since ADR-020: null, never omitted, so a
      // clip with no depth is explicitly "no depth" rather than "unspecified".
      depthPath: null,
      sidecar: { clipId: "c1" },
      metricKeys: STEP.metricKeys,
      minFps: STEP.minFps,
      levelToleranceDegrees: STEP.levelToleranceDegrees,
    });
  });

  it("appends every result as a validated metric-result event, then marks clip analysed and job done", async () => {
    const { runner, events, prisma } = setup();
    await runner.process({ id: "j1", clipId: "c1", attempts: 1 });
    expect(events.appendValidated).toHaveBeenCalledTimes(STEP.metricKeys.length);
    expect(events.appendValidated).toHaveBeenCalledWith("s1", "metric-result", expect.objectContaining({ metricKey: STEP.metricKeys[0] }));
    expect(prisma.clip.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { status: "analyzed" } });
    expect(prisma.analysisJob.update).toHaveBeenCalledWith({
      where: { id: "j1" },
      data: { status: "done", lockedAt: null, lastError: null },
    });
  });

  it("deletes the clip file after analysis when the consent has no raw_video scope", async () => {
    const { runner, clipFile, consent } = setup({ scopes: ["derived_events"] });
    await runner.process({ id: "j1", clipId: "c1", attempts: 1 });
    expect(consent.hasActiveScope).toHaveBeenCalledWith("consent1", "raw_video");
    expect(existsSync(clipFile)).toBe(false);
  });

  it("keeps the clip file when the consent has the raw_video scope", async () => {
    const { runner, clipFile } = setup({ scopes: ["derived_events", "raw_video"] });
    await runner.process({ id: "j1", clipId: "c1", attempts: 1 });
    expect(existsSync(clipFile)).toBe(true);
  });

  it("deletes the clip file when the consent cannot be read (never keep video on doubt)", async () => {
    const { runner, clipFile, consent } = setup({ scopes: ["raw_video"] });
    consent.hasActiveScope.mockRejectedValue(new Error("db down"));
    await runner.process({ id: "j1", clipId: "c1", attempts: 1 });
    expect(existsSync(clipFile)).toBe(false);
  });

  it("stores unsupported results as they are", async () => {
    const response = okResponse();
    response.results[0] = {
      ...estimateResult(STEP.metricKeys[0]),
      estimate: undefined,
      unsupported: { reasons: ["out_of_frame"] },
    } as never;
    const { runner, events, prisma } = setup({ analyze: jest.fn().mockResolvedValue(response) });
    await runner.process({ id: "j1", clipId: "c1", attempts: 1 });
    expect(events.appendValidated.mock.calls[0][2].unsupported).toEqual({ reasons: ["out_of_frame"] });
    expect(prisma.clip.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { status: "analyzed" } });
  });

  describe("failures", () => {
    const failing = (error: Error) => jest.fn().mockRejectedValue(error);

    it("puts the job back to pending with the error while attempts remain, and keeps the clip file", async () => {
      const { runner, prisma, clipFile, events } = setup({ analyze: failing(new Error("ml down")), attempts: 1 });
      await runner.process({ id: "j1", clipId: "c1", attempts: 1 });
      expect(prisma.analysisJob.update).toHaveBeenCalledWith({
        where: { id: "j1" },
        data: { status: "pending", lockedAt: null, lastError: "ml down" },
      });
      expect(prisma.clip.update).not.toHaveBeenCalled();
      expect(events.appendValidated).not.toHaveBeenCalled();
      expect(existsSync(clipFile)).toBe(true);
    });

    it(`marks job and clip failed after ${MAX_ATTEMPTS} attempts and removes the file without raw_video consent`, async () => {
      const { runner, prisma, clipFile } = setup({ analyze: failing(new Error("ml down")), attempts: MAX_ATTEMPTS });
      await runner.process({ id: "j1", clipId: "c1", attempts: MAX_ATTEMPTS });
      expect(prisma.analysisJob.update).toHaveBeenCalledWith({
        where: { id: "j1" },
        data: { status: "failed", lockedAt: null, lastError: "ml down" },
      });
      expect(prisma.clip.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { status: "failed" } });
      expect(existsSync(clipFile)).toBe(false);
    });

    it("fails an analysis whose results cover fewer metrics than were requested (nothing is silently omitted)", async () => {
      const response = okResponse();
      response.results.pop();
      const { runner, events, prisma } = setup({ analyze: jest.fn().mockResolvedValue(response), attempts: 1 });
      await runner.process({ id: "j1", clipId: "c1", attempts: 1 });
      expect(events.appendValidated).not.toHaveBeenCalled();
      expect(prisma.analysisJob.update.mock.calls[0][0].data.status).toBe("pending");
      expect(prisma.analysisJob.update.mock.calls[0][0].data.lastError).toMatch(/missing/i);
    });

    it("fails a result that belongs to another session, clip or step", async () => {
      const response = okResponse();
      response.results[0] = estimateResult(STEP.metricKeys[0], { sessionId: "other" }) as never;
      const { runner, events } = setup({ analyze: jest.fn().mockResolvedValue(response) });
      await runner.process({ id: "j1", clipId: "c1", attempts: 1 });
      expect(events.appendValidated).not.toHaveBeenCalled();
    });

    it("fails the job when a result does not validate, before appending any result", async () => {
      const response = okResponse();
      response.results[1] = { ...estimateResult(STEP.metricKeys[1]), tier: "invented" } as never;
      const { runner, events, prisma } = setup({ analyze: jest.fn().mockResolvedValue(response) });
      await runner.process({ id: "j1", clipId: "c1", attempts: 1 });
      expect(events.appendValidated).not.toHaveBeenCalled();
      expect(prisma.analysisJob.update.mock.calls[0][0].data.status).toBe("pending");
    });
  });
});

describe("AnalysisJobRunner.tick", () => {
  it("processes claimed jobs up to the concurrency limit and stops when the queue is empty", async () => {
    const claimed = [1, 2, 3].map((n) => ({ id: `j${n}`, clipId: "c1", attempts: 1 }));
    const { runner, ml } = setup({ claimed });
    const started = await runner.tick();
    expect(started).toBe(2);
    await runner.idle();
    expect(ml.analyzeClip).toHaveBeenCalledTimes(2);
    await runner.tick();
    await runner.idle();
    expect(ml.analyzeClip).toHaveBeenCalledTimes(3);
  });

  it("does not start the polling loop when ANALYSIS_CONCURRENCY is 0", () => {
    const { prisma } = setup();
    const off = new AnalysisJobRunner(prisma as never, {} as never, {} as never, battery, {} as never, 0, 1000);
    off.onModuleInit();
    expect(off.isPolling()).toBe(false);
  });
});

describe("AnalysisJobRunner.reapExhausted", () => {
  it("fails jobs that were running when the worker stopped and have no attempts left, and their clips", async () => {
    const { runner, prisma } = setup({ claimed: [{ clipId: "c9" }] });
    await runner.reapExhausted();
    const strings = (prisma.$queryRaw.mock.calls[0][0] as readonly string[]).join("?");
    expect(strings).toMatch(/status = 'failed'/);
    expect(strings).toMatch(/status = 'running'/);
    expect(strings).toMatch(/RETURNING "clipId"/);
    expect(prisma.clip.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["c9"] } }, data: { status: "failed" } });
  });
});

describe("AnalysisJobRunner and the depth track (ADR-020)", () => {
  it("passes the clip's depthPath to ml-service", async () => {
    const { runner, ml, depthFile } = setup({ depth: true });
    await runner.process({ id: "j1", clipId: "c1", attempts: 1 });
    expect(ml.analyzeClip).toHaveBeenCalledWith(expect.objectContaining({ depthPath: depthFile }));
  });

  it("passes depthPath: null when the clip has no depth track", async () => {
    const { runner, ml } = setup();
    await runner.process({ id: "j1", clipId: "c1", attempts: 1 });
    expect(ml.analyzeClip).toHaveBeenCalledWith(expect.objectContaining({ depthPath: null }));
  });

  it("deletes the depth track with the clip when the consent has no raw_video scope", async () => {
    const { runner, clipFile, depthFile } = setup({ depth: true });
    await runner.process({ id: "j1", clipId: "c1", attempts: 1 });
    expect(existsSync(clipFile)).toBe(false);
    // A depth map is a recording of the person: it must never outlive the video.
    expect(existsSync(depthFile as string)).toBe(false);
  });

  it("keeps the depth track only when the clip itself is kept under raw_video", async () => {
    const { runner, clipFile, depthFile } = setup({ depth: true, scopes: ["raw_video"] });
    await runner.process({ id: "j1", clipId: "c1", attempts: 1 });
    expect(existsSync(clipFile)).toBe(true);
    expect(existsSync(depthFile as string)).toBe(true);
  });

  it("still deletes the depth track when the clip file is already gone", async () => {
    const { runner, clipFile, depthFile } = setup({ depth: true });
    rmSync(clipFile);
    await runner.process({ id: "j1", clipId: "c1", attempts: 1 });
    expect(existsSync(depthFile as string)).toBe(false);
  });

  it("deletes the depth track when the job finally fails", async () => {
    const analyze = jest.fn().mockRejectedValue(new Error("ml down"));
    const { runner, clipFile, depthFile } = setup({ depth: true, analyze, attempts: MAX_ATTEMPTS });
    await runner.process({ id: "j1", clipId: "c1", attempts: MAX_ATTEMPTS });
    expect(existsSync(clipFile)).toBe(false);
    expect(existsSync(depthFile as string)).toBe(false);
  });
});
