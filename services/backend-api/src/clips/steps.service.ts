import { Injectable } from "@nestjs/common";
import { BatteryService } from "../battery/battery.service";
import type { MetricResult } from "../battery/types";
import { PrismaService } from "../common/prisma.service";
import { EventsService } from "../events/events.service";

export type StepStatus = "missing" | "processing" | "analyzed" | "failed";

export interface StepStatusRow {
  stepId: string;
  status: StepStatus;
  /** True only when every metric of the step has an estimate (nothing is unsupported). */
  usable: boolean;
  /** Distinct quality reasons of the step's unsupported results, in first-seen order. */
  reasons: string[];
}

/**
 * What the app shows after each upload (GET /sessions/:id/steps): for each
 * battery step, the state of its newest clip. Only the quality outcome is
 * exposed here - no measured numbers.
 */
@Injectable()
export class StepsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly battery: BatteryService
  ) {}

  async statusFor(sessionId: string): Promise<StepStatusRow[]> {
    const clips: Array<{ id: string; stepId: string; status: string; createdAt: Date }> = await this.prisma.clip.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    });
    const resultEvents = await this.events.listForSessionByType(sessionId, "metric-result");

    const newest = new Map<string, (typeof clips)[number]>();
    for (const clip of clips) {
      if (clip.status === "discarded") continue;
      const current = newest.get(clip.stepId);
      if (!current || clip.createdAt.getTime() >= current.createdAt.getTime()) newest.set(clip.stepId, clip);
    }

    return this.battery.battery.steps.map((step) => {
      const clip = newest.get(step.stepId);
      if (!clip) return { stepId: step.stepId, status: "missing", usable: false, reasons: [] };
      if (clip.status === "failed") return { stepId: step.stepId, status: "failed", usable: false, reasons: [] };
      if (clip.status !== "analyzed") return { stepId: step.stepId, status: "processing", usable: false, reasons: [] };

      // Newest result per (metricKey, side) of this clip: a retried analysis appends again.
      const latest = new Map<string, MetricResult>();
      for (const event of resultEvents) {
        const result = event.payload as unknown as MetricResult;
        if (result.clipId !== clip.id) continue;
        latest.set(`${result.metricKey}|${String(result.side)}`, result);
      }
      const results = [...latest.values()];
      const reasons: string[] = [];
      for (const result of results) {
        for (const reason of result.unsupported?.reasons ?? []) if (!reasons.includes(reason)) reasons.push(reason);
      }
      const covered = step.metricKeys.every((key) => results.some((r) => r.metricKey === key));
      const usable = covered && results.every((r) => r.estimate !== undefined);
      return { stepId: step.stepId, status: "analyzed", usable, reasons };
    });
  }
}
