import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { PilotMetricsController } from "./pilot-metrics.controller";
import { PilotMetricsService } from "./pilot-metrics.service";

@Module({
  imports: [AuthModule],
  controllers: [PilotMetricsController],
  providers: [PilotMetricsService, PrismaService],
  exports: [PilotMetricsService],
})
export class PilotMetricsModule {}
