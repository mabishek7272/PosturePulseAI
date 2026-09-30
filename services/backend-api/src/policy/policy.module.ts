import { Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { EventsModule } from "../events/events.module";
import { SafetyModule } from "../safety/safety.module";
import { WsModule } from "../ws/ws.module";
import { DeviationDetectorService } from "./deviation-detector.service";
import { PolicyEngineService } from "./policy-engine.service";
import { RepCounterService } from "./rep-counter.service";

@Module({
  imports: [EventsModule, SafetyModule, WsModule],
  providers: [PolicyEngineService, DeviationDetectorService, RepCounterService, PrismaService],
  exports: [PolicyEngineService],
})
export class PolicyModule {}
