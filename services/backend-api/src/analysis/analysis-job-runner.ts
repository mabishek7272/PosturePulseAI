import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { rm } from "node:fs/promises";
import { BatteryService } from "../battery/battery.service";
import type { MetricResult } from "../battery/types";
import { PrismaService } from "../common/prisma.service";
import { getValidator } from "../common/schema-registry";
import { ConsentService } from "../consent/consent.service";
import { EventsService } from "../events/events.service";
import { MlClientService } from "../ml-integration/ml-client.service";

export const MAX_ATTEMPTS = 3;
const STALE_RUNNING_MINUTES = 15;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_POLL_MS = 1000;

export interface ClaimedJob {
  id: string;
  clipId: string;
  attempts: number;
}

export function concurrencyFromEnv(): number {
  const raw = process.env.ANALYSIS_CONCURRENCY;
  if (raw === undefined || raw === "") return DEFAULT_CONCURRENCY;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_CONCURRENCY;
}

/**
 * In-process job runner over the AnalysisJob table (ADR-013). A job is claimed
 * with one UPDATE ... FOR UPDATE SKIP LOCKED statement, so several backend
 * instances can poll the same table without picking the same job. The runner
 * sends the clip to ml-service, stores each returned MetricResult in the event
 * log, and deletes the clip file unless the session's consent includes
 * raw_video. It never touches the safety state machine.
 */
@Injectable()
export class AnalysisJobRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalysisJobRunner.name);
  private readonly inFlight = new Set<Promise<void>>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ml: MlClientService,
    private readonly events: EventsService,
    private readonly battery: BatteryService,
    private readonly consent: ConsentService,
    private readonly concurrency: number = concurrencyFromEnv(),
    private readonly pollMs: number = DEFAULT_POLL_MS
  ) {}

  onModuleInit(): void {
    if (this.concurrency <= 0) {
      this.logger.warn("ANALYSIS_CONCURRENCY is 0: this instance does not analyse clips.");
      return;
    }
    void this.reapExhausted().catch((e) => this.logger.error(`reapExhausted failed: ${(e as Error).message}`));
    this.timer = setInterval(() => {
      void this.tick().catch((e) => this.logger.error(`analysis poll failed: ${(e as Error).message}`));
    }, this.pollMs);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.idle();
  }

  isPolling(): boolean {
    return this.timer !== null;
  }

  /** Resolves when every job started so far has finished. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  /** Starts as many jobs as there are free slots and pending work; returns how many were started. */
  async tick(): Promise<number> {
    let started = 0;
    while (this.inFlight.size < this.concurrency) {
      const job = await this.claimNext();
      if (!job) break;
      const run: Promise<void> = this.process(job)
        .catch((e) => this.logger.error(`job ${job.id}: ${(e as Error).message}`))
        .finally(() => this.inFlight.delete(run));
      this.inFlight.add(run);
      started += 1;
    }
    return started;
  }

  /**
   * Claims the oldest pending job (or a job left "running" by a worker that
   * stopped more than STALE_RUNNING_MINUTES ago and still has attempts left).
   */
  async claimNext(): Promise<ClaimedJob | null> {
    const rows = await this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE "AnalysisJob"
      SET status = 'running', "lockedAt" = NOW(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM "AnalysisJob"
        WHERE attempts < ${MAX_ATTEMPTS}
          AND (status = 'pending'
               OR (status = 'running' AND "lockedAt" < NOW() - ${STALE_RUNNING_MINUTES} * INTERVAL '1 minute'))
        ORDER BY "createdAt"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "clipId", attempts`;
    return rows[0] ?? null;
  }

  /** A worker that died during its last attempt leaves a job nothing will claim again: mark it failed. */
  async reapExhausted(): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<{ clipId: string }>>`
      UPDATE "AnalysisJob"
      SET status = 'failed', "lockedAt" = NULL, "lastError" = 'The worker stopped before the last attempt finished.'
      WHERE status = 'running'
        AND attempts >= ${MAX_ATTEMPTS}
        AND "lockedAt" < NOW() - ${STALE_RUNNING_MINUTES} * INTERVAL '1 minute'
      RETURNING "clipId"`;
    if (rows.length > 0) {
      await this.prisma.clip.updateMany({ where: { id: { in: rows.map((r) => r.clipId) } }, data: { status: "failed" } });
    }
  }

  /** Runs one claimed job to completion. Never throws: a failure is recorded on the job. */
  async process(job: ClaimedJob): Promise<void> {
    let sessionId: string | null = null;
    let clipPath: string | null = null;
    try {
      const clip = await this.prisma.clip.findUnique({ where: { id: job.clipId } });
      if (!clip) throw new Error(`Clip ${job.clipId} does not exist.`);
      sessionId = clip.sessionId;
      clipPath = clip.path;
      const step = this.battery.step(clip.stepId);
      if (!step) throw new Error(`Clip ${clip.id} is for unknown step "${clip.stepId}".`);

      const response = await this.ml.analyzeClip({
        sessionId: clip.sessionId,
        clipId: clip.id,
        stepId: clip.stepId,
        clipPath: clip.path,
        sidecar: clip.sidecar,
        metricKeys: step.metricKeys,
        minFps: step.minFps,
        levelToleranceDegrees: step.levelToleranceDegrees,
      });

      const results = this.checkResults(response?.results, clip, step.metricKeys);
      // All results are checked before the first is stored, so a bad response leaves nothing half-written.
      for (const result of results) {
        await this.events.appendValidated(clip.sessionId, "metric-result", result);
      }
      await this.prisma.$transaction([
        this.prisma.clip.update({ where: { id: clip.id }, data: { status: "analyzed" } }),
        this.prisma.analysisJob.update({ where: { id: job.id }, data: { status: "done", lockedAt: null, lastError: null } }),
      ]);
      await this.deleteUnlessKept(sessionId, clipPath);
    } catch (error) {
      await this.recordFailure(job, error as Error, sessionId, clipPath);
    }
  }

  private checkResults(
    raw: unknown,
    clip: { id: string; sessionId: string; stepId: string },
    metricKeys: string[]
  ): MetricResult[] {
    if (!Array.isArray(raw)) throw new Error("ml-service returned no results array.");
    const validate = getValidator("metric-result");
    const seen = new Set<string>();
    for (const item of raw) {
      if (!validate(item)) {
        throw new Error(`A result does not conform to metric-result: ${JSON.stringify(validate.errors)}`);
      }
      const result = item as MetricResult;
      if (result.sessionId !== clip.sessionId || result.clipId !== clip.id || result.stepId !== clip.stepId) {
        throw new Error(`Result ${result.resultId} names a different session, clip or step than the job.`);
      }
      if (!metricKeys.includes(result.metricKey)) {
        throw new Error(`Result ${result.resultId} is for "${result.metricKey}", which was not requested.`);
      }
      seen.add(result.metricKey);
    }
    const missing = metricKeys.filter((k) => !seen.has(k));
    if (missing.length > 0) {
      throw new Error(`Results are missing for: ${missing.join(", ")}.`);
    }
    return raw as MetricResult[];
  }

  private async recordFailure(job: ClaimedJob, error: Error, sessionId: string | null, clipPath: string | null): Promise<void> {
    const lastError = (error.message || "unknown error").slice(0, 500);
    const final = job.attempts >= MAX_ATTEMPTS;
    this.logger.warn(`job ${job.id} attempt ${job.attempts}/${MAX_ATTEMPTS} failed: ${lastError}`);
    try {
      await this.prisma.analysisJob.update({
        where: { id: job.id },
        data: { status: final ? "failed" : "pending", lockedAt: null, lastError },
      });
      if (final) {
        await this.prisma.clip.update({ where: { id: job.clipId }, data: { status: "failed" } });
        if (sessionId && clipPath) await this.deleteUnlessKept(sessionId, clipPath);
      }
    } catch (e) {
      this.logger.error(`job ${job.id}: could not record the failure: ${(e as Error).message}`);
    }
  }

  /** The clip file is kept only when the session's consent positively includes raw_video. */
  private async deleteUnlessKept(sessionId: string, clipPath: string): Promise<void> {
    let keep = false;
    try {
      const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
      keep = session ? await this.consent.hasActiveScope(session.consentRecordId, "raw_video") : false;
    } catch {
      keep = false;
    }
    if (keep) return;
    try {
      await rm(clipPath, { force: true });
    } catch (e) {
      this.logger.error(`could not delete ${clipPath}: ${(e as Error).message}`);
    }
  }
}
