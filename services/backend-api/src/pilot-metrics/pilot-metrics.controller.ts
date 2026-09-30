import { Controller, Get, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuditAction } from "../audit/audit-action.decorator";
import { AuditLogInterceptor } from "../audit/audit-log.interceptor";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { PilotMetricsService } from "./pilot-metrics.service";

/** Aggregate safety-monitoring metrics for a study's oversight group (docs/phase4/safety-monitoring-plan.md). */
@Controller("pilot-metrics")
export class PilotMetricsController {
  constructor(private readonly pilotMetrics: PilotMetricsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("clinician")
  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("view_pilot_metrics")
  @Get()
  getSummary() {
    return this.pilotMetrics.getSummary();
  }
}
