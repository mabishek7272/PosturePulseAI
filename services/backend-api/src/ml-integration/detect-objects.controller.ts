import { Body, Controller, Param, Post } from "@nestjs/common";
import { EventsService } from "../events/events.service";
import { SessionGateway } from "../ws/session.gateway";
import { MlClientService } from "./ml-client.service";

interface DetectObjectsBody {
  frameId: string;
  imageBase64: string;
}

/**
 * Separate, low-cadence entry point from /sessions/:sessionId/frames -
 * object detection is sampled far less often than pose (TRD 2.2) and never
 * feeds the safety policy engine (generic detections only, no ergonomic
 * classification - see docs/adr/006-object-detection-scope.md).
 */
@Controller("sessions/:sessionId/detect-objects")
export class DetectObjectsController {
  constructor(
    private readonly mlClient: MlClientService,
    private readonly events: EventsService,
    private readonly gateway: SessionGateway
  ) {}

  @Post()
  async submit(@Param("sessionId") sessionId: string, @Body() body: DetectObjectsBody) {
    const objectDetectionFrame = await this.mlClient.detectObjects({ sessionId, ...body });
    await this.events.appendValidated(sessionId, "object-detection-frame", objectDetectionFrame);
    this.gateway.broadcast(sessionId, "object-detection-frame", objectDetectionFrame);
    return objectDetectionFrame;
  }
}
