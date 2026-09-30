import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AdverseEventsModule } from "./adverse-events/adverse-events.module";
import { AuditLogModule } from "./audit/audit-log.module";
import { AuthModule } from "./auth/auth.module";
import { ConsentModule } from "./consent/consent.module";
import { EventsModule } from "./events/events.module";
import { ExposureModule } from "./exposure/exposure.module";
import { HealthModule } from "./health/health.module";
import { MlIntegrationModule } from "./ml-integration/ml-integration.module";
import { MovementModule } from "./movement/movement.module";
import { PolicyModule } from "./policy/policy.module";
import { PilotMetricsModule } from "./pilot-metrics/pilot-metrics.module";
import { ProtocolsModule } from "./protocols/protocols.module";
import { ResearchExportModule } from "./research-export/research-export.module";
import { SafetyModule } from "./safety/safety.module";
import { SensorsModule } from "./sensors/sensors.module";
import { SessionsModule } from "./sessions/sessions.module";
import { SymptomsModule } from "./symptoms/symptoms.module";
import { WsModule } from "./ws/ws.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
    AuthModule,
    ProtocolsModule,
    SessionsModule,
    EventsModule,
    SafetyModule,
    SymptomsModule,
    MlIntegrationModule,
    PolicyModule,
    ExposureModule,
    MovementModule,
    ConsentModule,
    SensorsModule,
    WsModule,
    AuditLogModule,
    AdverseEventsModule,
    ResearchExportModule,
    PilotMetricsModule,
  ],
})
export class AppModule {}
