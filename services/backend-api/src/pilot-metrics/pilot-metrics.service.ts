import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

interface QualityGateFlagPayload {
  state: "supported" | "unsupported";
}

interface DecisionEventPayload {
  action: "no_action" | "cue" | "escalate_review" | "measurement_unavailable";
}

/**
 * Real, computed aggregate metrics for a study's data safety/clinical
 * oversight group (docs/phase4/safety-monitoring-plan.md;
 * study-charter-skeleton.md's "Study C" oversight group). A rate is `null`,
 * never 0, when its denominator is 0 - "no data yet" must never be
 * indistinguishable from "measured and found to be zero" (the same
 * never-fabricate-a-measurement principle as quality_gate.py).
 */
@Injectable()
export class PilotMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const sessions = await this.prisma.session.findMany({ select: { state: true } });
    const sessionsByState: Record<string, number> = {};
    for (const session of sessions) {
      sessionsByState[session.state] = (sessionsByState[session.state] ?? 0) + 1;
    }

    const qualityFlagEvents = await this.prisma.event.findMany({
      where: { type: "quality-gate-flag" },
      select: { payload: true },
    });
    const unsupportedCount = qualityFlagEvents.filter(
      (event) => (event.payload as unknown as QualityGateFlagPayload).state === "unsupported"
    ).length;

    const decisionEvents = await this.prisma.event.findMany({
      where: { type: "decision-event" },
      select: { payload: true },
    });
    const decisionActionCounts: Record<string, number> = {};
    for (const event of decisionEvents) {
      const action = (event.payload as unknown as DecisionEventPayload).action;
      decisionActionCounts[action] = (decisionActionCounts[action] ?? 0) + 1;
    }

    const symptomReportCount = await this.prisma.event.count({ where: { type: "symptom-report" } });
    const totalAdverseEvents = await this.prisma.adverseEvent.count();
    const seriousAdverseEvents = await this.prisma.adverseEvent.count({ where: { serious: true } });

    return {
      totalSessions: sessions.length,
      sessionsByState,
      qualityGate: {
        totalFlags: qualityFlagEvents.length,
        unsupportedCount,
        unsupportedRate: rate(unsupportedCount, qualityFlagEvents.length),
      },
      decisions: {
        totalDecisions: decisionEvents.length,
        byAction: decisionActionCounts,
        cueRate: rate(decisionActionCounts["cue"] ?? 0, decisionEvents.length),
        escalateReviewRate: rate(decisionActionCounts["escalate_review"] ?? 0, decisionEvents.length),
      },
      symptomReports: {
        totalSymptomReports: symptomReportCount,
        ratePerSession: rate(symptomReportCount, sessions.length),
      },
      adverseEvents: {
        totalAdverseEvents,
        seriousAdverseEvents,
        ratePerSession: rate(totalAdverseEvents, sessions.length),
      },
    };
  }
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}
