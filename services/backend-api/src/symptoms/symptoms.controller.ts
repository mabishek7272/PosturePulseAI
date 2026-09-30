import { Body, Controller, Headers, Logger, Post } from "@nestjs/common";
import { v4 as uuid } from "uuid";
import { isSubjectTokenFor, SubjectAuthService } from "../auth/subject-auth.service";
import { EventsService } from "../events/events.service";
import { SafetyService } from "../safety/safety.service";
import { SessionGateway } from "../ws/session.gateway";

interface SymptomReportBody {
  sessionId: string;
  symptoms: string[];
  severity: "mild" | "moderate" | "severe";
  freeText?: string | null;
  triggeredAction?: "pause" | "escalate_review";
}

/**
 * Always accepted, regardless of concurrent ML confidence - this is the
 * user-facing side of the safety state machine's precedence rule. See
 * safety-state-machine.spec.ts "safety rules structurally outrank ML-driven
 * events".
 */
@Controller("symptom-reports")
export class SymptomsController {
  private readonly logger = new Logger(SymptomsController.name);

  constructor(
    private readonly events: EventsService,
    private readonly safety: SafetyService,
    private readonly gateway: SessionGateway,
    private readonly subjectAuth: SubjectAuthService
  ) {}

  /**
   * Never rejected for missing/invalid auth: a forged report can only pause a
   * session (the safe direction), while rejecting a real one would leave a
   * subject who feels unwell in an active session (CLAUDE.md rule 2,
   * docs/adr/012). Auth status is checked after the pause and only logged.
   */
  @Post()
  async report(@Body() body: SymptomReportBody, @Headers("authorization") authorization?: string) {
    const symptomReportId = uuid();
    const triggeredAction = body.triggeredAction ?? "pause";

    const record = {
      symptomReportId,
      sessionId: body.sessionId,
      reportedAt: new Date().toISOString(),
      symptoms: body.symptoms,
      severity: body.severity,
      freeText: body.freeText ?? null,
      triggeredAction,
    };

    await this.events.appendValidated(body.sessionId, "symptom-report", record);
    const state = await this.safety.reportSymptom(body.sessionId, symptomReportId, triggeredAction);

    this.gateway.broadcast(body.sessionId, "state", { state });
    this.gateway.broadcast(body.sessionId, "symptom-report", record);

    await this.logIfUnauthenticated(body.sessionId, authorization);
    return { symptomReportId, state };
  }

  private async logIfUnauthenticated(sessionId: string, authorization: string | undefined) {
    const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
    if (!isSubjectTokenFor(await this.subjectAuth.verify(token), sessionId)) {
      this.logger.warn(`session ${sessionId}: symptom report accepted without a valid session token`);
    }
  }
}
