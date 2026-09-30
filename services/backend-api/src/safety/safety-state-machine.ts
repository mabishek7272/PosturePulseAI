import { createMachine, assign } from "xstate";

/**
 * Deterministic safety state machine (TRD 2.5). Safety rules outrank AI/ML
 * output: Pause and Unavailable have NO transition back out driven by an ML
 * signal (SUSTAINED_DEVIATION / CUE_DELIVERED) - only an explicit escalation,
 * clinician-approved resume, or reacquire/recalibrate event can leave them.
 * This is what makes "safety rules outrank AI scores" a structural property of
 * the graph rather than a convention callers must remember.
 *
 * Matches the PRD's state diagram exactly: EVERY symptom/contraindication report
 * lands in Pause first, no matter its severity - escalation to ClinicianReview is
 * a distinct second step taken from Pause (via ESCALATION_RULE), never a way to
 * skip Pause. safety.service.ts is responsible for sending ESCALATION_RULE right
 * after SYMPTOM_REPORTED when the report's triggeredAction is escalate_review;
 * the machine itself never conflates "pause" and "escalate" into one edge.
 *
 * Extension beyond the PRD's literal diagram: QUALITY_LOST is accepted from both
 * Observing and CueEligible (the diagram only draws it from Observing). Treating
 * quality/identity loss as irrelevant while a cue is momentarily eligible would
 * contradict "quality/identity loss force-transitions to Unavailable regardless
 * of model output" - so the extra edge is a deliberate safety-conservative
 * choice, not a deviation from intent.
 *
 * ClinicianReview has no outgoing transition in this phase, matching the PRD
 * diagram exactly - resolving a clinician review is part of the (deferred)
 * clinician dashboard workflow, not this phase's scaffolding.
 */

export type SafetyState =
  | "Setup"
  | "Observing"
  | "CueEligible"
  | "Pause"
  | "Unavailable"
  | "ClinicianReview";

export interface SafetyContext {
  sessionId: string;
  lastTransitionReason?: string;
}

export type SafetyEvent =
  | { type: "CALIBRATED" }
  | { type: "SETUP_UNAVAILABLE"; reason: string }
  | { type: "SUSTAINED_DEVIATION" }
  | { type: "CUE_DELIVERED" }
  | { type: "SYMPTOM_REPORTED"; symptomReportId: string }
  | { type: "ESCALATION_RULE"; reason: string }
  | { type: "QUALITY_LOST"; reason: string }
  | { type: "REACQUIRED" }
  | { type: "CLINICIAN_APPROVED_RESUME" };

const recordReason = assign<SafetyContext, SafetyEvent, unknown, SafetyEvent, never>(({ event }) => ({
  lastTransitionReason:
    "reason" in event ? event.reason : "symptomReportId" in event ? event.symptomReportId : event.type,
}));

export const safetyMachine = createMachine({
  id: "safety",
  types: {} as {
    context: SafetyContext;
    events: SafetyEvent;
  },
  context: ({ input }: { input: { sessionId: string } }) => ({
    sessionId: input.sessionId,
  }),
  initial: "Setup",
  states: {
    Setup: {
      on: {
        CALIBRATED: { target: "Observing" },
        SETUP_UNAVAILABLE: { target: "Unavailable", actions: recordReason },
      },
    },
    Observing: {
      on: {
        SUSTAINED_DEVIATION: { target: "CueEligible" },
        SYMPTOM_REPORTED: { target: "Pause", actions: recordReason },
        QUALITY_LOST: { target: "Unavailable", actions: recordReason },
      },
    },
    CueEligible: {
      on: {
        CUE_DELIVERED: { target: "Observing" },
        SYMPTOM_REPORTED: { target: "Pause", actions: recordReason },
        QUALITY_LOST: { target: "Unavailable", actions: recordReason },
      },
    },
    Pause: {
      on: {
        ESCALATION_RULE: { target: "ClinicianReview", actions: recordReason },
        CLINICIAN_APPROVED_RESUME: { target: "Setup" },
      },
    },
    Unavailable: {
      on: {
        REACQUIRED: { target: "Setup" },
      },
    },
    ClinicianReview: {
      type: "final",
    },
  },
});
