import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { MlClientModule } from "../ml-integration/ml-client.module";
import { WsModule } from "../ws/ws.module";
import { MovementWindowBufferService } from "./movement-window-buffer.service";

@Module({
  imports: [EventsModule, WsModule, MlClientModule],
  providers: [MovementWindowBufferService],
  exports: [MovementWindowBufferService],
})
export class MovementModule {}
