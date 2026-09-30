import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { getValidator, schemaVersionId } from "../common/schema-registry";

/**
 * Append-only event log. Deliberately exposes no update/delete - callers that
 * need to "correct" a record append a new event referencing the old one instead.
 * DB-level REVOKE UPDATE/DELETE hardening is a named follow-up (see
 * docs/hazard-analysis.md, docs/adr), not enforced at the DB level in this phase.
 */
@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Appends a record without schema validation (internal bookkeeping events, e.g. state_transition). */
  async append(sessionId: string, type: string, schemaId: string, payload: unknown) {
    return this.prisma.event.create({
      data: { sessionId, type, schemaId, payload: payload as object },
    });
  }

  /**
   * Validates `payload` against the named canonical schema (packages/schemas/src)
   * before appending. Throws BadRequestException on a schema-invalid payload -
   * this is the enforcement point for "never fabricate a measurement" /
   * "cue requires cuePayload" etc. for anything entering the event log.
   */
  async appendValidated(sessionId: string, schemaName: Parameters<typeof getValidator>[0], payload: unknown) {
    const validate = getValidator(schemaName);
    if (!validate(payload)) {
      throw new BadRequestException({
        message: `Payload does not conform to schema "${schemaName}"`,
        errors: validate.errors,
      });
    }
    return this.append(sessionId, schemaName, schemaVersionId(schemaName), payload);
  }

  async listForSession(sessionId: string) {
    return this.prisma.event.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    });
  }
}
