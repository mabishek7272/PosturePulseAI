import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConsentModule } from "../consent/consent.module";
import { EventsModule } from "../events/events.module";
import { SessionsModule } from "../sessions/sessions.module";
import { ResearchExportController } from "./research-export.controller";
import { ResearchExportService } from "./research-export.service";

@Module({
  imports: [SessionsModule, EventsModule, ConsentModule, AuthModule],
  controllers: [ResearchExportController],
  providers: [ResearchExportService],
})
export class ResearchExportModule {}
