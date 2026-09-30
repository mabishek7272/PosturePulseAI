import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuditAction } from "../audit/audit-action.decorator";
import { AuditLogInterceptor } from "../audit/audit-log.interceptor";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AdverseEventsService, CreateAdverseEventInput } from "./adverse-events.service";

/** Clinical-trial adverse event documentation (docs/phase4/) - clinician-only, always audited. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("clinician")
@UseInterceptors(AuditLogInterceptor)
@Controller("adverse-events")
export class AdverseEventsController {
  constructor(private readonly adverseEvents: AdverseEventsService) {}

  @AuditAction("create_adverse_event")
  @Post()
  create(@Body() body: CreateAdverseEventInput) {
    return this.adverseEvents.create(body);
  }

  @AuditAction("list_adverse_events")
  @Get()
  list(
    @Query("subjectPseudoId") subjectPseudoId?: string,
    @Query("sessionId") sessionId?: string,
    @Query("seriousOnly") seriousOnly?: string
  ) {
    return this.adverseEvents.list({ subjectPseudoId, sessionId, seriousOnly: seriousOnly === "true" });
  }

  @AuditAction("record_ethics_board_report")
  @Post(":id/reported-to-ethics-board")
  recordEthicsBoardReport(@Param("id") id: string) {
    return this.adverseEvents.recordEthicsBoardReport(id);
  }
}
