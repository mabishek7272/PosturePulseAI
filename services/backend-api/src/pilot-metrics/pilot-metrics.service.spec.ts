import { PilotMetricsService } from "./pilot-metrics.service";

function buildService(overrides: {
  sessions?: Array<{ state: string }>;
  qualityFlags?: Array<{ payload: unknown }>;
  decisions?: Array<{ payload: unknown }>;
  symptomReportCount?: number;
  totalAdverseEvents?: number;
  seriousAdverseEvents?: number;
} = {}) {
  const {
    sessions = [],
    qualityFlags = [],
    decisions = [],
    symptomReportCount = 0,
    totalAdverseEvents = 0,
    seriousAdverseEvents = 0,
  } = overrides;

  const prisma = {
    session: { findMany: jest.fn().mockResolvedValue(sessions) },
    event: {
      findMany: jest.fn((args: { where: { type: string } }) => {
        if (args.where.type === "quality-gate-flag") return Promise.resolve(qualityFlags);
        if (args.where.type === "decision-event") return Promise.resolve(decisions);
        return Promise.resolve([]);
      }),
      count: jest.fn().mockResolvedValue(symptomReportCount),
    },
    adverseEvent: {
      count: jest.fn((args?: { where?: { serious?: boolean } }) =>
        Promise.resolve(args?.where?.serious ? seriousAdverseEvents : totalAdverseEvents)
      ),
    },
  };
  return { service: new PilotMetricsService(prisma as never) };
}

describe("PilotMetricsService", () => {
  it("returns null rates rather than 0 when there is no data yet", async () => {
    const { service } = buildService();
    const summary = await service.getSummary();

    expect(summary.totalSessions).toBe(0);
    expect(summary.qualityGate.unsupportedRate).toBeNull();
    expect(summary.decisions.cueRate).toBeNull();
    expect(summary.symptomReports.ratePerSession).toBeNull();
    expect(summary.adverseEvents.ratePerSession).toBeNull();
  });

  it("tallies sessions by state", async () => {
    const { service } = buildService({
      sessions: [{ state: "Observing" }, { state: "Observing" }, { state: "Pause" }],
    });
    const summary = await service.getSummary();
    expect(summary.totalSessions).toBe(3);
    expect(summary.sessionsByState).toEqual({ Observing: 2, Pause: 1 });
  });

  it("computes the quality-gate unsupported rate from real event payloads", async () => {
    const { service } = buildService({
      qualityFlags: [{ payload: { state: "supported" } }, { payload: { state: "unsupported" } }, { payload: { state: "unsupported" } }],
    });
    const summary = await service.getSummary();
    expect(summary.qualityGate.totalFlags).toBe(3);
    expect(summary.qualityGate.unsupportedCount).toBe(2);
    expect(summary.qualityGate.unsupportedRate).toBeCloseTo(2 / 3);
  });

  it("computes decision action breakdown and cue/escalate rates", async () => {
    const { service } = buildService({
      decisions: [
        { payload: { action: "cue" } },
        { payload: { action: "no_action" } },
        { payload: { action: "escalate_review" } },
        { payload: { action: "no_action" } },
      ],
    });
    const summary = await service.getSummary();
    expect(summary.decisions.byAction).toEqual({ cue: 1, no_action: 2, escalate_review: 1 });
    expect(summary.decisions.cueRate).toBeCloseTo(0.25);
    expect(summary.decisions.escalateReviewRate).toBeCloseTo(0.25);
  });

  it("reports adverse event counts and the serious subset separately", async () => {
    const { service } = buildService({
      sessions: [{ state: "Observing" }, { state: "Observing" }],
      totalAdverseEvents: 2,
      seriousAdverseEvents: 1,
    });
    const summary = await service.getSummary();
    expect(summary.adverseEvents.totalAdverseEvents).toBe(2);
    expect(summary.adverseEvents.seriousAdverseEvents).toBe(1);
    expect(summary.adverseEvents.ratePerSession).toBeCloseTo(1);
  });
});
