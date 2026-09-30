import { Controller, Get, Param, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuditAction } from "../audit/audit-action.decorator";
import { AuditLogInterceptor } from "../audit/audit-log.interceptor";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { ResearchExportService } from "./research-export.service";

/** De-identified research export for a single session's consenting subject - clinician-only, audited. */
@Controller("sessions/:sessionId/research-export")
export class ResearchExportController {
  constructor(private readonly researchExport: ResearchExportService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("clinician")
  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("export_research_data")
  @Get()
  export(@Param("sessionId") sessionId: string) {
    return this.researchExport.exportSession(sessionId);
  }
}
