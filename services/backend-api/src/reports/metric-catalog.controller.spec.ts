import "reflect-metadata";
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from "@nestjs/common/constants";
import { AUDIT_ACTION_KEY } from "../audit/audit-action.decorator";
import { AuditLogInterceptor } from "../audit/audit-log.interceptor";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ROLES_KEY } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { MetricCatalogController } from "./metric-catalog.controller";

describe("GET /metric-catalog", () => {
  it("is clinician-only and audited", () => {
    const handler = MetricCatalogController.prototype.get;
    expect(Reflect.getMetadata(GUARDS_METADATA, MetricCatalogController)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, MetricCatalogController)).toEqual(["clinician"]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, handler)).toEqual([AuditLogInterceptor]);
    expect(Reflect.getMetadata(AUDIT_ACTION_KEY, handler)).toBe("view_metric_catalog");
  });

  it("returns ml-service's catalog unchanged", async () => {
    const catalog = { metricsVersion: "metrics/v2", metrics: [], notMeasurable: [] };
    const controller = new MetricCatalogController({ getMetricCatalog: jest.fn().mockResolvedValue(catalog) } as never);
    await expect(controller.get()).resolves.toBe(catalog);
  });
});
