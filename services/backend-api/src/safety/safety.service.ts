import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createActor, type Actor } from "xstate";
import { PrismaService } from "../common/prisma.service";
import { EventsService } from "../events/events.service";
import { safetyMachine, type SafetyEvent, type SafetyState } from "./safety-state-machine";

type SafetyActor = Actor<typeof safetyMachine>;

/**
 * Thin wrapper around the safetyMachine actor per session. Persists both the
 * denormalized `state` string and the full XState snapshot (for correct
 * rehydration via the officially supported createActor(machine, { snapshot })
 * path after a process restart - see prisma/schema.prisma comment on
 * Session.safetySnapshot).
 */
@Injectable()
export class SafetyService {
  private readonly logger = new Logger(SafetyService.name);
  private readonly actors = new Map<string, SafetyActor>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService
  ) {}

  async startSession(sessionId: string): Promise<SafetyState> {
    const actor = createActor(safetyMachine, { input: { sessionId } });
    actor.start();
    this.actors.set(sessionId, actor);
    await this.persist(sessionId, actor);
    return actor.getSnapshot().value as SafetyState;
  }

  /**
   * Sends a single event. Callers that need to enforce priority between
   * concurrently-arriving signals (e.g. a symptom report and an ML cue
   * candidate for the same frame) MUST call send() for the higher-priority
   * event first and inspect the resulting state - once a session is in Pause
   * or Unavailable, subsequent ML-driven events simply have no matching
   * transition and are safely ignored by the machine, so priority is
   * structural, not something this method needs to re-implement.
   */
  async send(sessionId: string, event: SafetyEvent): Promise<SafetyState> {
    const actor = await this.getOrRehydrate(sessionId);
    const before = actor.getSnapshot().value as SafetyState;
    actor.send(event);
    const after = actor.getSnapshot().value as SafetyState;
    await this.persist(sessionId, actor);

    if (before !== after) {
      await this.events.append(sessionId, "state_transition", "safety-state-machine/v0", {
        from: before,
        to: after,
        event,
      });
      this.logger.log(`session ${sessionId}: ${before} -> ${after} (${event.type})`);
    }
    return after;
  }

  /**
   * Always lands in Pause first (structurally, via send()), then - only as a
   * distinct second step - escalates to ClinicianReview if the report calls
   * for it. This mirrors the PRD diagram: escalation is never a way to skip
   * Pause, whatever the report's severity.
   */
  async reportSymptom(
    sessionId: string,
    symptomReportId: string,
    triggeredAction: "pause" | "escalate_review"
  ): Promise<SafetyState> {
    await this.send(sessionId, { type: "SYMPTOM_REPORTED", symptomReportId });
    if (triggeredAction === "escalate_review") {
      return this.send(sessionId, { type: "ESCALATION_RULE", reason: symptomReportId });
    }
    return this.getState(sessionId);
  }

  async getState(sessionId: string): Promise<SafetyState> {
    const actor = await this.getOrRehydrate(sessionId);
    return actor.getSnapshot().value as SafetyState;
  }

  private async getOrRehydrate(sessionId: string): Promise<SafetyActor> {
    const existing = this.actors.get(sessionId);
    if (existing) return existing;

    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    const actor = session.safetySnapshot
      ? createActor(safetyMachine, { input: { sessionId }, snapshot: session.safetySnapshot as never })
      : createActor(safetyMachine, { input: { sessionId } });
    actor.start();
    this.actors.set(sessionId, actor);
    return actor;
  }

  private async persist(sessionId: string, actor: SafetyActor): Promise<void> {
    const snapshot = actor.getPersistedSnapshot();
    const value = actor.getSnapshot().value as SafetyState;
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { state: value, safetySnapshot: snapshot as object },
    });
  }
}
