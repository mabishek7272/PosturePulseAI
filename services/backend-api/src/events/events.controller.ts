import { Controller, Get, Param, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuditAction } from "../audit/audit-action.decorator";
import { AuditLogInterceptor } from "../audit/audit-log.interceptor";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { EventsService } from "./events.service";

/** The full append-only event log for a session - clinician-only (docs/adr/010). */
@Controller("sessions/:sessionId/events")
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("clinician")
  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("view_events")
  @Get()
  list(@Param("sessionId") sessionId: string) {
    return this.events.listForSession(sessionId);
  }
}
