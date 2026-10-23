import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SessionOwnershipGuard } from "../auth/session-ownership.guard";
import { StepsService } from "./steps.service";

@Controller("sessions")
export class StepsController {
  constructor(private readonly steps: StepsService) {}

  /** Subject token for this session only. */
  @UseGuards(JwtAuthGuard, SessionOwnershipGuard)
  @Get(":id/steps")
  list(@Param("id") sessionId: string) {
    return this.steps.statusFor(sessionId);
  }
}
