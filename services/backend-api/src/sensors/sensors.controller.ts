import { Body, Controller, ForbiddenException, Post } from "@nestjs/common";
import { v4 as uuid } from "uuid";
import { ConsentService } from "../consent/consent.service";
import { EventsService } from "../events/events.service";
import { SessionGateway } from "../ws/session.gateway";

interface SubmitSensorReadingBody {
  sessionId: string;
  sensorType: "heart_rate";
  value: number;
  unit: "bpm";
  recordedAt: string;
  sourceDeviceId?: string | null;
  consentScopeRef: string;
}

/**
 * Optional, clearly-non-gating wearable input (PRD 4.6 default: symptom entry
 * is mandatory regardless; sensor integration is optional research context
 * only). This controller has NO dependency on SafetyService at all - not
 * imported anywhere in this file - so a sensor reading structurally cannot
 * gate the safety FSM, matching the same pattern as MovementWindowBufferService.
 */
@Controller("sensor-readings")
export class SensorsController {
  constructor(
    private readonly consent: ConsentService,
    private readonly events: EventsService,
    private readonly gateway: SessionGateway
  ) {}

  @Post()
  async submit(@Body() body: SubmitSensorReadingBody) {
    const hasConsent = await this.consent.hasActiveScope(body.consentScopeRef, "wearable_integration");
    if (!hasConsent) {
      throw new ForbiddenException(
        "No active consent record with 'wearable_integration' scope for the given consentScopeRef."
      );
    }

    const record = {
      sensorReadingId: uuid(),
      sessionId: body.sessionId,
      sensorType: body.sensorType,
      value: body.value,
      unit: body.unit,
      recordedAt: body.recordedAt,
      sourceDeviceId: body.sourceDeviceId ?? null,
      consentScopeRef: body.consentScopeRef,
    };

    await this.events.appendValidated(body.sessionId, "sensor-reading", record);
    this.gateway.broadcast(body.sessionId, "sensor-reading", record);
    return record;
  }
}
