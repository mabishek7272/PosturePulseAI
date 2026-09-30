import { Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { EventsModule } from "../events/events.module";
import { SafetyService } from "./safety.service";

@Module({
  imports: [EventsModule],
  providers: [SafetyService, PrismaService],
  exports: [SafetyService],
})
export class SafetyModule {}
