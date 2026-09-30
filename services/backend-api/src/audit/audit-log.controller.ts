import { Controller, Get, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AuditAction } from "./audit-action.decorator";
import { AuditLogInterceptor } from "./audit-log.interceptor";
import { AuditLogService } from "./audit-log.service";

/** Lets a clinician see who has looked at what - the auditability docs/adr/010 promised. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("clinician")
@Controller("audit-log")
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("view_audit_log")
  @Get()
  list(@Query("limit") limit?: string) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.auditLog.list(parsedLimit && Number.isFinite(parsedLimit) ? parsedLimit : undefined);
  }
}
