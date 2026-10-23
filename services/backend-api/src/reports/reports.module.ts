import { Module } from "@nestjs/common";
import { BatteryModule } from "../battery/battery.module";
import { PrismaService } from "../common/prisma.service";
import { EventsModule } from "../events/events.module";
import { MlClientModule } from "../ml-integration/ml-client.module";
import { ReportsController, SessionReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({
  imports: [BatteryModule, EventsModule, MlClientModule],
  controllers: [ReportsController, SessionReportsController],
  providers: [ReportsService, PrismaService],
  exports: [ReportsService],
})
export class ReportsModule {}
