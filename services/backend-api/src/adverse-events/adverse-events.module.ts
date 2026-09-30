import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { AdverseEventsController } from "./adverse-events.controller";
import { AdverseEventsService } from "./adverse-events.service";

@Module({
  imports: [AuthModule],
  controllers: [AdverseEventsController],
  providers: [AdverseEventsService, PrismaService],
  exports: [AdverseEventsService],
})
export class AdverseEventsModule {}
