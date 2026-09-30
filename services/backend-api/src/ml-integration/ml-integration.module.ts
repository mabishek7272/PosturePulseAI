import { Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { EventsModule } from "../events/events.module";
import { ExposureModule } from "../exposure/exposure.module";
import { MovementModule } from "../movement/movement.module";
import { PolicyModule } from "../policy/policy.module";
import { SafetyModule } from "../safety/safety.module";
import { WsModule } from "../ws/ws.module";
import { DetectObjectsController } from "./detect-objects.controller";
import { FramesController } from "./frames.controller";
import { MlClientModule } from "./ml-client.module";
import { MlResultConsumer } from "./ml-result.consumer";

@Module({
  imports: [MlClientModule, EventsModule, SafetyModule, WsModule, PolicyModule, ExposureModule, MovementModule],
  controllers: [FramesController, DetectObjectsController],
  providers: [MlResultConsumer, PrismaService],
  exports: [MlClientModule, MlResultConsumer],
})
export class MlIntegrationModule {}
