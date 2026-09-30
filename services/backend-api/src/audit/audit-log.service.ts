import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

export interface RecordAccessInput {
  clinicianId: string;
  clinicianUsername: string;
  action: string;
  sessionId?: string | null;
}

/**
 * Who looked at which subject's data, and when (docs/adr/010-clinician-authentication.md's
 * named follow-up). A logging failure must never break the read it's
 * auditing - see AuditLogInterceptor, which calls record() fire-and-forget
 * and only logs a warning on failure.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAccessInput): Promise<void> {
    try {
      await this.prisma.auditLogEntry.create({
        data: {
          clinicianId: input.clinicianId,
          clinicianUsername: input.clinicianUsername,
          action: input.action,
          sessionId: input.sessionId ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(`failed to record audit log entry for action "${input.action}": ${error}`);
    }
  }

  list(limit = 100) {
    return this.prisma.auditLogEntry.findMany({
      orderBy: { occurredAt: "desc" },
      take: limit,
    });
  }
}
