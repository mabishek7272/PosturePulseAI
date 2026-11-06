import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuditAction } from "../audit/audit-action.decorator";
import { AuditLogInterceptor } from "../audit/audit-log.interceptor";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { PatientErasureService } from "./patient-erasure.service";
import { NewPatient, PatientsService } from "./patients.service";

/**
 * Clinician-only (ADR-017). Every call is audited by action name only: the
 * audit log never receives a name, date of birth or contact.
 */
@Controller("patients")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("clinician")
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly erasure: PatientErasureService
  ) {}

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

  /** Declared before ":patientId" so "subject-names" is not read as an id. */
  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("view_patient_names")
  @Get("subject-names")
  subjectNames() {
    return this.patients.subjectNames();
  }

  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("view_patient")
  @Get(":patientId")
  get(@Param("patientId") patientId: string) {
    return this.patients.get(patientId);
  }

  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("list_patient_sessions")
  @Get(":patientId/sessions")
  sessions(@Param("patientId") patientId: string) {
    return this.patients.sessions(patientId);
  }

  /** Permanent. Body `{ confirmName }` must be the patient's exact name. */
  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("erase_patient")
  @Delete(":patientId")
  erase(@Param("patientId") patientId: string, @Body() body: { confirmName?: string }) {
    return this.erasure.erase(patientId, body?.confirmName);
  }
}
