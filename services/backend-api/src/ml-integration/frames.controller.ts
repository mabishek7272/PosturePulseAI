import { Body, Controller, Param, Post } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { MlClientService } from "./ml-client.service";
import { MlResultConsumer } from "./ml-result.consumer";

interface SubmitFrameBody {
  frameId: string;
  capturedAt: string;
  imageBase64: string;
}

/** Entry point for "push a frame through ml-service -> backend-api" (see docs/ verification plan). */
@Controller("sessions/:sessionId/frames")
export class FramesController {
  constructor(
    private readonly mlClient: MlClientService,
    private readonly mlResultConsumer: MlResultConsumer,
    private readonly prisma: PrismaService
  ) {}

  @Post()
  async submit(@Param("sessionId") sessionId: string, @Body() body: SubmitFrameBody) {
    // backend-api owns Session/ScaleCalibrationRecord data - ml-service never
    // guesses whether a session is scale-calibrated (see
    // ml-service/app/geometry/coordinate_frames.py#is_scale_validated).
    const session = await this.prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    const result = await this.mlClient.sendFrame({
      sessionId,
      ...body,
      scaleCalibrationRef: session.calibrationRef,
    });
    return this.mlResultConsumer.handleFrame(sessionId, result);
  }
}
