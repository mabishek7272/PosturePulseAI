import { Controller, Get, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuditAction } from "../audit/audit-action.decorator";
import { AuditLogInterceptor } from "../audit/audit-log.interceptor";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { MlClientService } from "../ml-integration/ml-client.service";

/**
 * What each metric measures and how (label, sign convention, description,
 * formula, and the shared method note), straight from ml-service's catalog,
 * so the app explains a value with the same text the pipeline that produced it
 * publishes. 503 when ml-service cannot answer; nothing is made up here.
 */
@Controller("metric-catalog")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("clinician")
export class MetricCatalogController {
  constructor(private readonly ml: MlClientService) {}

  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("view_metric_catalog")
  @Get()
  get() {
    return this.ml.getMetricCatalog();
  }
}
