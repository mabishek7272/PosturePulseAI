import { Module } from "@nestjs/common";
import { ConsentModule } from "../consent/consent.module";
import { EventsModule } from "../events/events.module";
import { WsModule } from "../ws/ws.module";
import { SensorsController } from "./sensors.controller";

@Module({
  imports: [ConsentModule, EventsModule, WsModule],
  controllers: [SensorsController],
})
export class SensorsModule {}
