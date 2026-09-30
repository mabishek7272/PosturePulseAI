import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { AuditLogController } from "./audit-log.controller";
import { AuditLogInterceptor } from "./audit-log.interceptor";
import { AuditLogService } from "./audit-log.service";

// Global for the same reason AuthModule is (see its own comment): controllers
// in other modules apply @UseInterceptors(AuditLogInterceptor) by class
// reference, which needs AuditLogInterceptor's own dependencies resolvable
// from wherever it's used, not just from this module's own DI context.
@Global()
@Module({
  imports: [AuthModule],
  controllers: [AuditLogController],
  providers: [AuditLogService, AuditLogInterceptor, PrismaService],
  exports: [AuditLogService, AuditLogInterceptor],
})
export class AuditLogModule {}
