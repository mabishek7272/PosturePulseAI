import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AnalysisModule } from "./analysis/analysis.module";
import { AdverseEventsModule } from "./adverse-events/adverse-events.module";
import { AuditLogModule } from "./audit/audit-log.module";
import { AuthModule } from "./auth/auth.module";
import { BatteryModule } from "./battery/battery.module";
import { ClipsModule } from "./clips/clips.module";
import { ConsentModule } from "./consent/consent.module";
import { EventsModule } from "./events/events.module";
import { ExposureModule } from "./exposure/exposure.module";
import { HealthModule } from "./health/health.module";
import { MlIntegrationModule } from "./ml-integration/ml-integration.module";
import { MovementModule } from "./movement/movement.module";
import { PatientsModule } from "./patients/patients.module";
import { PolicyModule } from "./policy/policy.module";
import { PilotMetricsModule } from "./pilot-metrics/pilot-metrics.module";
import { ProtocolsModule } from "./protocols/protocols.module";
import { ReportsModule } from "./reports/reports.module";
import { ResearchExportModule } from "./research-export/research-export.module";
import { SafetyModule } from "./safety/safety.module";
import { SpotterModule } from "./spotter/spotter.module";
import { SensorsModule } from "./sensors/sensors.module";
import { SessionsModule } from "./sessions/sessions.module";
import { SymptomsModule } from "./symptoms/symptoms.module";
import { WsModule } from "./ws/ws.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
    AuthModule,
    BatteryModule,
    ClipsModule,
    AnalysisModule,
    ReportsModule,
    PatientsModule,
    ProtocolsModule,
    SessionsModule,
    EventsModule,
    SafetyModule,
    SpotterModule,
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
