import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuditAction } from "../audit/audit-action.decorator";
import { AuditLogInterceptor } from "../audit/audit-log.interceptor";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ReportReaderGuard } from "../auth/report-reader.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { SessionOwnershipGuard } from "../auth/session-ownership.guard";
import { SubjectAuthService } from "../auth/subject-auth.service";
import { ReportsService } from "./reports.service";

/** request.user as set by JwtAuthGuard; only the token's subject (user id or subjectPseudoId) is used here. */
interface ClinicianRequest {
  user: { sub: string };
}

/**
 * Report routes that hang off a session: building a draft (clinician) and the
 * patient's access to a released report.
 */
@Controller("sessions")
export class SessionReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly subjectAuth: SubjectAuthService
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("clinician")
  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("build_report")
  @Post(":id/report")
  build(@Param("id") sessionId: string, @Req() req: ClinicianRequest) {
    return this.reports.build(sessionId, req.user.sub);
  }

  /** Subject token -> a long-lived token that can only read this session's released report. */
  @UseGuards(JwtAuthGuard, SessionOwnershipGuard)
  @Post(":id/report-access")
  async reportAccess(@Param("id") sessionId: string, @Req() req: ClinicianRequest) {
    return { reportAccessToken: await this.subjectAuth.issueReportAccessToken(sessionId, req.user.sub) };
  }

  /** Report-access token or subject token for this session. 404 {status: "pending_review"} until a clinician releases one. */
  @UseGuards(ReportReaderGuard)
  @Get(":id/released-report")
  async releasedReport(@Param("id") sessionId: string) {
    const report = await this.reports.latestReleased(sessionId);
    if (!report) throw new NotFoundException({ status: "pending_review" });
    return report;
  }
}

@Controller("reports")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("clinician")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("list_reports")
  @Get()
  list(@Query("status") status?: string) {
    return this.reports.list(status);
  }

  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("view_report")
  @Get(":reportId")
  get(@Param("reportId") reportId: string) {
    return this.reports.get(reportId);
  }

  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("exclude_report_row")
  @Post(":reportId/rows/exclude")
  exclude(
    @Param("reportId") reportId: string,
    @Body() body: { metricKey: string; side?: string | null; stepId?: string | null; reason: string },
    @Req() req: ClinicianRequest
  ) {
    return this.reports.excludeRow(reportId, req.user.sub, body);
  }

  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("write_report_assessment")
  @Post(":reportId/assessment")
  assess(@Param("reportId") reportId: string, @Body() body: { text: string }, @Req() req: ClinicianRequest) {
    return this.reports.setAssessment(reportId, req.user.sub, body?.text);
  }

  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("sign_off_report")
  @Post(":reportId/sign-off")
  signOff(
    @Param("reportId") reportId: string,
    @Body() body: { password: string; contentSha256?: string; reportVersion?: number },
    @Req() req: ClinicianRequest
  ) {
    return this.reports.signOff(reportId, req.user.sub, body?.password, body?.contentSha256, body?.reportVersion);
  }

  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("reject_report")
  @Post(":reportId/reject")
  reject(@Param("reportId") reportId: string, @Body() body: { reason: string }, @Req() req: ClinicianRequest) {
    return this.reports.reject(reportId, req.user.sub, body?.reason);
  }
}
