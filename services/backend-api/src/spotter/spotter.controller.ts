import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Req, UseGuards } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { JwtPayload } from "../auth/auth.service";
import { BatteryService } from "../battery/battery.service";
import { SpotterService } from "./spotter.service";

interface ConfirmBody {
  note?: string | null;
}

/**
 * Spotter attestations for steps whose battery entry sets `requiresSpotter`
 * (HZ-09, induced fall).
 *
 * **Clinician credentials, not the session token.** Every other call the
 * capture screen makes uses the subject session token, and deliberately not
 * this one: the whole value of the record is that an identified clinician
 * attested to being within arm's reach. A subject token would let the person
 * being assessed confirm their own spotter, which is the one party who cannot.
 */
@Controller("sessions/:sessionId/steps/:stepId/spotter-confirmation")
export class SpotterController {
  constructor(
    private readonly spotter: SpotterService,
    private readonly battery: BatteryService
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("clinician")
  @Post()
  async confirm(
    @Param("sessionId") sessionId: string,
    @Param("stepId") stepId: string,
    @Body() body: ConfirmBody,
    @Req() request: { user?: JwtPayload }
  ) {
    const step = this.battery.step(stepId);
    if (!step) throw new NotFoundException(`Unknown step "${stepId}".`);
    if (!step.requiresSpotter) {
      // Refused rather than accepted-and-ignored: a confirmation on a step that
      // does not need one would sit in the event log looking like evidence that
      // a spotter was present for something, and a later reader has no way to
      // tell it was never required.
      throw new BadRequestException(`Step "${stepId}" does not require a spotter.`);
    }

    const confirmedBy = request.user?.username ?? request.user?.sub;
    if (!confirmedBy) {
      // Unreachable through the guards; asserted because an unnamed attestation
      // is worse than none.
      throw new BadRequestException("The confirming clinician could not be identified.");
    }

    return this.spotter.confirm({ sessionId, stepId, confirmedBy, note: body?.note ?? null });
  }

  /** Lets the capture screen show whether this step is already cleared. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("clinician")
  @Get()
  async status(@Param("sessionId") sessionId: string, @Param("stepId") stepId: string) {
    const step = this.battery.step(stepId);
    if (!step) throw new NotFoundException(`Unknown step "${stepId}".`);
    return {
      requiresSpotter: step.requiresSpotter === true,
      confirmed: await this.spotter.isConfirmed(sessionId, stepId),
    };
  }
}
