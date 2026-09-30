import { Body, Controller, Post } from "@nestjs/common";
import { v4 as uuid } from "uuid";
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
  constructor(
    private readonly events: EventsService,
    private readonly safety: SafetyService,
    private readonly gateway: SessionGateway
  ) {}

  @Post()
  async report(@Body() body: SymptomReportBody) {
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

    return { symptomReportId, state };
  }
}
