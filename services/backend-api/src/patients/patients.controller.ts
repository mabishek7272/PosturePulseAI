import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuditAction } from "../audit/audit-action.decorator";
import { AuditLogInterceptor } from "../audit/audit-log.interceptor";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { NewPatient, PatientsService } from "./patients.service";

/**
 * Clinician-only (ADR-017). Every call is audited by action name only: the
 * audit log never receives a name, date of birth or contact.
 */
@Controller("patients")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("clinician")
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("create_patient")
  @Post()
  create(@Body() body: NewPatient, @Req() req: { user: { sub: string } }) {
    return this.patients.create(body, req.user.sub);
  }

  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("search_patients")
  @Get()
  search(@Query("q") q?: string) {
    return this.patients.search(q);
  }

  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("link_patient")
  @Post(":patientId/link")
  link(@Param("patientId") patientId: string, @Body() body: { subjectPseudoId: string }) {
    return this.patients.link(patientId, body?.subjectPseudoId);
  }

  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("list_patient_sessions")
  @Get(":patientId/sessions")
  sessions(@Param("patientId") patientId: string) {
    return this.patients.sessions(patientId);
  }
}
