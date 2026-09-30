import { Controller, Get, Param, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuditAction } from "../audit/audit-action.decorator";
import { AuditLogInterceptor } from "../audit/audit-log.interceptor";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { PrismaService } from "../common/prisma.service";

interface ExposureEventPayload {
  postureBucket: string;
  validSeconds: number;
  totalWindowSeconds: number;
}

/** The "clinician review" surface for exposure data, now backed by apps/clinician-web. Clinician-only (docs/adr/010). */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("clinician")
@UseInterceptors(AuditLogInterceptor)
@Controller("sessions/:sessionId/exposure")
export class ExposureController {
  constructor(private readonly prisma: PrismaService) {}

  @AuditAction("view_exposure_events")
  @Get("events")
  async listEvents(@Param("sessionId") sessionId: string) {
    return this.prisma.event.findMany({
      where: { sessionId, type: "exposure-event" },
      orderBy: { createdAt: "asc" },
    });
  }

  @AuditAction("view_exposure_summary")
  @Get("summary")
  async summary(@Param("sessionId") sessionId: string) {
    const events = await this.prisma.event.findMany({
      where: { sessionId, type: "exposure-event" },
      orderBy: { createdAt: "asc" },
    });

    const byBucket = new Map<string, { validSeconds: number; totalWindowSeconds: number }>();
    for (const event of events) {
      const payload = event.payload as unknown as ExposureEventPayload;
      const current = byBucket.get(payload.postureBucket) ?? { validSeconds: 0, totalWindowSeconds: 0 };
      current.validSeconds += payload.validSeconds;
      current.totalWindowSeconds += payload.totalWindowSeconds;
      byBucket.set(payload.postureBucket, current);
    }

    return Object.fromEntries(byBucket);
  }
}
