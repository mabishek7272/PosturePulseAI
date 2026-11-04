import { Module } from "@nestjs/common";
import { BatteryModule } from "../battery/battery.module";
import { BatteryService } from "../battery/battery.service";
import { PrismaService } from "../common/prisma.service";
import { EventsModule } from "../events/events.module";
import { SafetyModule } from "../safety/safety.module";
import { SafetyService } from "../safety/safety.service";
import { SpotterModule } from "../spotter/spotter.module";
import { SpotterService } from "../spotter/spotter.service";
import { ClipUploadStateGuard } from "./clip-upload-state.guard";
import { ClipsController } from "./clips.controller";
import { ClipsService } from "./clips.service";
import { StepsController } from "./steps.controller";
import { StepsService } from "./steps.service";

@Module({
  imports: [BatteryModule, SafetyModule, EventsModule, SpotterModule],
  controllers: [ClipsController, StepsController],
  providers: [
    PrismaService,
    ClipUploadStateGuard,
    StepsService,
    // useFactory so Nest does not try to inject ClipsService's optional clipDir argument.
    {
      provide: ClipsService,
      useFactory: (
        prisma: PrismaService,
        safety: SafetyService,
        battery: BatteryService,
        spotter: SpotterService
      ) => new ClipsService(prisma, safety, battery, spotter),
      inject: [PrismaService, SafetyService, BatteryService, SpotterService],
    },
  ],
  exports: [ClipsService],
})
export class ClipsModule {}
