import { Injectable } from "@nestjs/common";
import { v4 as uuid } from "uuid";
import { PrismaService } from "../common/prisma.service";
import { EventsService } from "../events/events.service";

export const SPOTTER_EVENT_TYPE = "spotter-confirmation";

/**
 * HZ-09's structural control (`docs/hazard-analysis.md`): a step that asks
 * someone to stand with their eyes closed, or on one leg, cannot be captured
 * until a named clinician has attested they are within arm's reach of that
 * person for that step.
 *
 * Two halves, and the server half is what makes it structural rather than
 * documented. The app will not offer the shutter without a confirmation, but an
 * app is a client: it can be an old build, a modified build, or simply wrong.
 * `ClipsService` therefore refuses the clip too, so bypassing the prompt does
 * not get a capture into the record. The hazard table's own bar is that
 * HZ-01/02/03/05 are "structurally enforced ... not just documented", and this
 * is what meeting that bar looks like for HZ-09.
 */
@Injectable()
export class SpotterService {
  constructor(
    private readonly events: EventsService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Records an attestation. `confirmedBy` comes from the clinician's verified
   * token and is never taken from the request body - an attestation nobody is
   * named on says only that a button was tapped.
   */
  async confirm(input: {
    sessionId: string;
    stepId: string;
    confirmedBy: string;
    note?: string | null;
  }): Promise<{ confirmationId: string; confirmedAt: string }> {
    const record = {
      confirmationId: uuid(),
      sessionId: input.sessionId,
      stepId: input.stepId,
      confirmedAt: new Date().toISOString(),
      confirmedBy: input.confirmedBy,
      // Always true; the schema pins it with `const`. A "no" is not a
      // recordable state - it means the step does not run, so there is nothing
      // to attest to.
      withinArmsReach: true as const,
      note: input.note ?? null,
    };
    await this.events.appendValidated(input.sessionId, SPOTTER_EVENT_TYPE, record);
    return { confirmationId: record.confirmationId, confirmedAt: record.confirmedAt };
  }

  /**
   * Whether this session and step already carry an attestation.
   *
   * Scoped to the step, never the session: one tick must not cover a step the
   * clinician never saw. Standing on the left leg and standing on the right are
   * separate steps and separate risks.
   */
  async isConfirmed(sessionId: string, stepId: string): Promise<boolean> {
    const rows = await this.prisma.event.findMany({
      where: { sessionId, type: SPOTTER_EVENT_TYPE },
    });
    return rows.some((row) => (row.payload as { stepId?: unknown } | null)?.stepId === stepId);
  }
}
