import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BatteryModule } from "../battery/battery.module";
import { PrismaService } from "../common/prisma.service";
import { EventsModule } from "../events/events.module";
import { SpotterController } from "./spotter.controller";
import { SpotterService } from "./spotter.service";

@Module({
  imports: [AuthModule, BatteryModule, EventsModule],
  controllers: [SpotterController],
  providers: [SpotterService, PrismaService],
  // Exported so ClipsService can refuse a clip for a requiresSpotter step that
  // carries no attestation - the half of HZ-09 a client cannot bypass.
  exports: [SpotterService],
})
export class SpotterModule {}
