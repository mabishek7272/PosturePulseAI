import { PolicyEngineService } from "./policy-engine.service";
import { DeviationDetectorService } from "./deviation-detector.service";
import { RepCounterService } from "./rep-counter.service";

function makeAngle(jointName: string, degrees: number) {
  return { jointName, thetaRadians: (degrees * Math.PI) / 180 };
}

function buildEngine(overrides: { exercise?: unknown } = {}) {
  const events = { appendValidated: jest.fn().mockResolvedValue(undefined) };
  const safety = {
    send: jest.fn().mockResolvedValue("Observing"),
    getState: jest.fn().mockResolvedValue("Observing"),
  };
  const gateway = { broadcast: jest.fn() };
  const exercise = overrides.exercise ?? {
    exerciseId: "e1",
    toleranceDegrees: 12,
    repRange: { min: 1, max: 3 },
    targetJointAngles: [{ jointName: "leftKnee", targetDegrees: 170 }],
  };
  const prisma = {
    session: { findUniqueOrThrow: jest.fn().mockResolvedValue({ protocolId: "p1", protocolVersion: "v0-draft" }) },
    protocolVersion: {
      findUnique: jest.fn().mockResolvedValue({ definition: { exercises: [exercise] } }),
    },
  };
  const deviationDetector = new DeviationDetectorService();
  const repCounter = new RepCounterService();

  const engine = new PolicyEngineService(
    events as never,
    safety as never,
    gateway as never,
    prisma as never,
    deviationDetector,
    repCounter
  );

  return { engine, events, safety, gateway, prisma };
}

describe("PolicyEngineService - precedence", () => {
  it("unsupported quality always produces measurement_unavailable and QUALITY_LOST, regardless of angle data", async () => {
    const { engine, events, safety } = buildEngine();
    const qualityGateFlag = { flagId: "f1", state: "unsupported" as const, reasons: ["occlusion"] };

    const result = await engine.evaluateFrame(
      "s1",
      qualityGateFlag,
      { jointFrameId: "cjf1", angles: [makeAngle("leftKnee", 100)] } // even with deviation-worthy data present
    );

    expect((result.decisionEvent as { action: string }).action).toBe("measurement_unavailable");
    expect(safety.send).toHaveBeenCalledWith("s1", { type: "QUALITY_LOST", reason: "occlusion" });
    expect(events.appendValidated).toHaveBeenCalledWith("s1", "decision-event", expect.objectContaining({ action: "measurement_unavailable" }));
  });

  it("supported quality with no computable angles produces no decision event", async () => {
    const { engine, events } = buildEngine();
    const result = await engine.evaluateFrame("s1", { flagId: "f1", state: "supported", reasons: [] }, null);
    expect(result.decisionEvent).toBeNull();
    expect(events.appendValidated).not.toHaveBeenCalled();
  });

  it("sustained deviation produces a real cue with dereferenceable evidence, only when the FSM grants CueEligible", async () => {
    const { engine, events, safety } = buildEngine();
    safety.send.mockResolvedValueOnce("CueEligible").mockResolvedValueOnce("Observing");

    let result;
    for (let i = 0; i < 5; i++) {
      result = await engine.evaluateFrame(
        "s1",
        { flagId: "f1", state: "supported", reasons: [] },
        { jointFrameId: "cjf1", angles: [makeAngle("leftKnee", 100)] } // 70deg off a 170deg target, tolerance 12
      );
    }

    expect((result!.decisionEvent as { action: string }).action).toBe("cue");
    expect((result!.decisionEvent as { cuePayload: unknown }).cuePayload).not.toBeNull();
    expect((result!.decisionEvent as { evidence: Array<{ refId: string }> }).evidence[0].refId).toBe("cjf1");
    expect(safety.send).toHaveBeenNthCalledWith(1, "s1", { type: "SUSTAINED_DEVIATION" });
    expect(safety.send).toHaveBeenNthCalledWith(2, "s1", { type: "CUE_DELIVERED" });
  });

  it("does not build a cue if a concurrent safety signal already moved the FSM out of CueEligible reach", async () => {
    const { engine, safety } = buildEngine();
    safety.send.mockResolvedValue("Pause"); // e.g. a symptom report won the race

    let result;
    for (let i = 0; i < 5; i++) {
      result = await engine.evaluateFrame(
        "s1",
        { flagId: "f1", state: "supported", reasons: [] },
        { jointFrameId: "cjf1", angles: [makeAngle("leftKnee", 100)] }
      );
    }

    expect(result!.decisionEvent).toBeNull();
    expect(result!.safetyState).toBe("Pause");
    // Only SUSTAINED_DEVIATION should have been sent - never CUE_DELIVERED, since Pause won.
    expect(safety.send).toHaveBeenCalledWith("s1", { type: "SUSTAINED_DEVIATION" });
    expect(safety.send).not.toHaveBeenCalledWith("s1", { type: "CUE_DELIVERED" });
  });

  it("rep overflow produces escalate_review WITHOUT touching the safety FSM", async () => {
    const { engine, safety } = buildEngine();
    const angles = { jointFrameId: "cjf1", angles: [makeAngle("leftKnee", 170)] }; // within tolerance of target 170

    let result;
    // descend/ascend cycles to exceed repRange.max = 3
    const cycle = [170, 100, 170];
    for (let rep = 0; rep < 4; rep++) {
      for (const degrees of cycle) {
        result = await engine.evaluateFrame(
          "s1",
          { flagId: "f1", state: "supported", reasons: [] },
          { jointFrameId: "cjf1", angles: [makeAngle("leftKnee", degrees)] }
        );
      }
    }

    expect((result!.decisionEvent as { action: string } | null)?.action).toBe("escalate_review");
    expect(safety.send).not.toHaveBeenCalled(); // no SUSTAINED_DEVIATION/CUE_DELIVERED/QUALITY_LOST - never touched
  });

  it("no active exercise resolvable -> no decision event, never crashes", async () => {
    const { engine, events, prisma } = buildEngine();
    (prisma.protocolVersion.findUnique as jest.Mock).mockResolvedValue({ definition: { exercises: [] } });

    const result = await engine.evaluateFrame(
      "s1",
      { flagId: "f1", state: "supported", reasons: [] },
      { jointFrameId: "cjf1", angles: [makeAngle("leftKnee", 100)] }
    );

    expect(result.decisionEvent).toBeNull();
    expect(events.appendValidated).not.toHaveBeenCalled();
  });
});
