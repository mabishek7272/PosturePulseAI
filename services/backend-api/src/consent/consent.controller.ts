import { Body, Controller, Get, Param, Post, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuditAction } from "../audit/audit-action.decorator";
import { AuditLogInterceptor } from "../audit/audit-log.interceptor";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { ConsentSignaturesService, SignaturesInput } from "./consent-signatures.service";
import { ConsentService, CreateConsentRecordInput } from "./consent.service";

@Controller("consent-records")
export class ConsentController {
  constructor(
    private readonly consent: ConsentService,
    private readonly signatures: ConsentSignaturesService
  ) {}

  @Post()
  create(@Body() body: CreateConsentRecordInput) {
    return this.consent.create(body);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.consent.get(id);
  }

  /** Attach the patient's and the signed-in clinician's signatures (write-once). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("clinician")
  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("sign_consent")
  @Post(":id/signatures")
  sign(@Param("id") id: string, @Body() body: SignaturesInput, @Req() req: { user: { sub: string } }) {
    return this.signatures.attach(id, body, req.user.sub);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("clinician")
  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("view_consent_signatures")
  @Get(":id/signatures")
  getSignatures(@Param("id") id: string) {
    return this.signatures.get(id);
  }
}
