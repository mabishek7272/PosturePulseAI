import { Module } from "@nestjs/common";
import { BatteryModule } from "../battery/battery.module";
import { BatteryService } from "../battery/battery.service";
import { PrismaService } from "../common/prisma.service";
import { ConsentModule } from "../consent/consent.module";
import { ConsentService } from "../consent/consent.service";
import { EventsModule } from "../events/events.module";
import { EventsService } from "../events/events.service";
import { MlClientModule } from "../ml-integration/ml-client.module";
import { MlClientService } from "../ml-integration/ml-client.service";
import { AnalysisJobRunner } from "./analysis-job-runner";

/** Background analysis of uploaded clips (ADR-013). Starts polling on boot unless ANALYSIS_CONCURRENCY=0. */
@Module({
  imports: [BatteryModule, EventsModule, MlClientModule, ConsentModule],
  providers: [
    PrismaService,
    // useFactory so Nest does not try to inject the runner's numeric options.
    {
      provide: AnalysisJobRunner,
      useFactory: (prisma: PrismaService, ml: MlClientService, events: EventsService, battery: BatteryService, consent: ConsentService) =>
        new AnalysisJobRunner(prisma, ml, events, battery, consent),
      inject: [PrismaService, MlClientService, EventsService, BatteryService, ConsentService],
    },
  ],
})
export class AnalysisModule {}
