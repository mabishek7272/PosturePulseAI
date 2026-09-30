import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { EventsModule } from "../events/events.module";
import { MlClientModule } from "../ml-integration/ml-client.module";
import { SafetyModule } from "../safety/safety.module";
import { WsModule } from "../ws/ws.module";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";

@Module({
  imports: [SafetyModule, EventsModule, MlClientModule, WsModule, AuthModule],
  controllers: [SessionsController],
  providers: [SessionsService, PrismaService],
  exports: [SessionsService],
})
export class SessionsModule {}
