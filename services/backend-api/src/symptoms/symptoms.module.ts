import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { SafetyModule } from "../safety/safety.module";
import { WsModule } from "../ws/ws.module";
import { SymptomsController } from "./symptoms.controller";

@Module({
  imports: [EventsModule, SafetyModule, WsModule],
  controllers: [SymptomsController],
})
export class SymptomsModule {}
