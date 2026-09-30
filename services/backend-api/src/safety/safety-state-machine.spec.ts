import { createActor } from "xstate";
import { safetyMachine, type SafetyState } from "./safety-state-machine";

function actorAt(sessionId = "s1") {
  const actor = createActor(safetyMachine, { input: { sessionId } });
  actor.start();
  return actor;
}

function value(actor: ReturnType<typeof actorAt>): SafetyState {
  return actor.getSnapshot().value as SafetyState;
}

describe("safetyMachine - basic transitions", () => {
  it("starts in Setup", () => {
    expect(value(actorAt())).toBe("Setup");
  });

  it("Setup -> Observing on CALIBRATED", () => {
    const actor = actorAt();
    actor.send({ type: "CALIBRATED" });
    expect(value(actor)).toBe("Observing");
  });

  it("Setup -> Unavailable on SETUP_UNAVAILABLE (poor view / missing plan)", () => {
    const actor = actorAt();
    actor.send({ type: "SETUP_UNAVAILABLE", reason: "missing_plan" });
    expect(value(actor)).toBe("Unavailable");
  });

  it("Observing -> CueEligible on SUSTAINED_DEVIATION", () => {
    const actor = actorAt();
    actor.send({ type: "CALIBRATED" });
    actor.send({ type: "SUSTAINED_DEVIATION" });
    expect(value(actor)).toBe("CueEligible");
  });

  it("CueEligible -> Observing on CUE_DELIVERED (single approved cue then reassess)", () => {
    const actor = actorAt();
    actor.send({ type: "CALIBRATED" });
    actor.send({ type: "SUSTAINED_DEVIATION" });
    actor.send({ type: "CUE_DELIVERED" });
    expect(value(actor)).toBe("Observing");
  });

  it("Unavailable -> Setup on REACQUIRED", () => {
    const actor = actorAt();
    actor.send({ type: "SETUP_UNAVAILABLE", reason: "poor_view" });
    actor.send({ type: "REACQUIRED" });
    expect(value(actor)).toBe("Setup");
  });

  it("Pause -> Setup on CLINICIAN_APPROVED_RESUME", () => {
    const actor = actorAt();
    actor.send({ type: "CALIBRATED" });
    actor.send({ type: "SYMPTOM_REPORTED", symptomReportId: "sym-1" });
    actor.send({ type: "CLINICIAN_APPROVED_RESUME" });
    expect(value(actor)).toBe("Setup");
  });

  it("Pause -> ClinicianReview on ESCALATION_RULE", () => {
    const actor = actorAt();
    actor.send({ type: "CALIBRATED" });
    actor.send({ type: "SYMPTOM_REPORTED", symptomReportId: "sym-1" });
    actor.send({ type: "ESCALATION_RULE", reason: "sym-1" });
    expect(value(actor)).toBe("ClinicianReview");
  });
});

describe("safetyMachine - symptom/contraindication always lands in Pause first", () => {
  it("Observing -> Pause on SYMPTOM_REPORTED", () => {
    const actor = actorAt();
    actor.send({ type: "CALIBRATED" });
    actor.send({ type: "SYMPTOM_REPORTED", symptomReportId: "sym-1" });
    expect(value(actor)).toBe("Pause");
  });

  it("CueEligible -> Pause on SYMPTOM_REPORTED", () => {
    const actor = actorAt();
    actor.send({ type: "CALIBRATED" });
    actor.send({ type: "SUSTAINED_DEVIATION" });
    actor.send({ type: "SYMPTOM_REPORTED", symptomReportId: "sym-1" });
    expect(value(actor)).toBe("Pause");
  });

  it("cannot reach ClinicianReview without first passing through Pause", () => {
    const actor = actorAt();
    actor.send({ type: "CALIBRATED" });
    actor.send({ type: "SUSTAINED_DEVIATION" });
    // ESCALATION_RULE is not a valid CueEligible transition - it only exists on Pause.
    actor.send({ type: "ESCALATION_RULE" as never, reason: "sym-1" } as never);
    expect(value(actor)).toBe("CueEligible");
  });
});

describe("safetyMachine - quality/identity loss forces Unavailable", () => {
  it("Observing -> Unavailable on QUALITY_LOST", () => {
    const actor = actorAt();
    actor.send({ type: "CALIBRATED" });
    actor.send({ type: "QUALITY_LOST", reason: "identity_uncertain" });
    expect(value(actor)).toBe("Unavailable");
  });

  it("CueEligible -> Unavailable on QUALITY_LOST", () => {
    const actor = actorAt();
    actor.send({ type: "CALIBRATED" });
    actor.send({ type: "SUSTAINED_DEVIATION" });
    actor.send({ type: "QUALITY_LOST", reason: "occlusion" });
    expect(value(actor)).toBe("Unavailable");
  });
});

describe("safetyMachine - safety rules structurally outrank ML-driven events", () => {
  it("once Paused, a subsequent ML cue-eligibility event does not leave Pause", () => {
    const actor = actorAt();
    actor.send({ type: "CALIBRATED" });
    actor.send({ type: "SUSTAINED_DEVIATION" }); // ML says "cue eligible"
    actor.send({ type: "SYMPTOM_REPORTED", symptomReportId: "sym-1" }); // safety signal wins
    expect(value(actor)).toBe("Pause");

    // Any further ML-driven signal arriving after the pause must not resurrect coaching.
    actor.send({ type: "SUSTAINED_DEVIATION" });
    expect(value(actor)).toBe("Pause");
    actor.send({ type: "CUE_DELIVERED" });
    expect(value(actor)).toBe("Pause");
  });

  it("once Unavailable due to quality loss, an ML cue-eligibility event does not resurrect coaching", () => {
    const actor = actorAt();
    actor.send({ type: "CALIBRATED" });
    actor.send({ type: "QUALITY_LOST", reason: "insufficient_landmarks" });
    expect(value(actor)).toBe("Unavailable");

    actor.send({ type: "SUSTAINED_DEVIATION" });
    expect(value(actor)).toBe("Unavailable");
  });

  it("ClinicianReview is a terminal checkpoint in this phase - no event moves out of it", () => {
    const actor = actorAt();
    actor.send({ type: "CALIBRATED" });
    actor.send({ type: "SYMPTOM_REPORTED", symptomReportId: "sym-1" });
    actor.send({ type: "ESCALATION_RULE", reason: "sym-1" });
    expect(value(actor)).toBe("ClinicianReview");

    actor.send({ type: "CLINICIAN_APPROVED_RESUME" });
    expect(value(actor)).toBe("ClinicianReview");
    actor.send({ type: "REACQUIRED" });
    expect(value(actor)).toBe("ClinicianReview");
  });
});
