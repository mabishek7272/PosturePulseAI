import { ForbiddenException, Injectable } from "@nestjs/common";
import { ConsentService } from "../consent/consent.service";
import { EventsService } from "../events/events.service";
import { SessionsService } from "../sessions/sessions.service";

/**
 * De-identified research data export (docs/phase4/data-management-plan.md).
 * Operationalizes the `research_data_export` consent scope
 * (consent-record.schema.json), which existed since Phase 0 but had no
 * enforcement point until now.
 *
 * Never includes raw video: the Event log this reads from structurally
 * cannot contain it (docs/consent-and-retention.md - raw video, when
 * opted into at all, is tracked by its own retention window and was never
 * wired to be written into Event.payload by any producer in this
 * codebase). This export additionally never includes `consentRecordId`
 * itself or any field beyond the pseudonymous `subjectPseudoId` that could
 * serve as a join key back to identity.
 */
@Injectable()
export class ResearchExportService {
  constructor(
    private readonly sessions: SessionsService,
    private readonly events: EventsService,
    private readonly consent: ConsentService
  ) {}

  async exportSession(sessionId: string) {
    const session = await this.sessions.get(sessionId);
    const hasConsent = await this.consent.hasActiveScope(session.consentRecordId, "research_data_export");
    if (!hasConsent) {
      throw new ForbiddenException(
        "No active consent record with 'research_data_export' scope for this session's subject."
      );
    }

    const events = await this.events.listForSession(sessionId);

    return {
      subjectPseudoId: session.subjectPseudoId,
      protocolId: session.protocolId,
      protocolVersion: session.protocolVersion,
      deploymentContext: session.deploymentContext,
      sessionCreatedAt: session.createdAt,
      events: events.map((event) => ({
        type: event.type,
        schemaId: event.schemaId,
        payload: event.payload,
        recordedAt: event.createdAt,
      })),
    };
  }
}
