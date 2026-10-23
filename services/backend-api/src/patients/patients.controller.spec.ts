import "reflect-metadata";
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { randomBytes } from "node:crypto";
import { AUDIT_ACTION_KEY } from "../audit/audit-action.decorator";
import { AuditLogModule } from "../audit/audit-log.module";
import { AuditLogInterceptor } from "../audit/audit-log.interceptor";
import { AuthModule } from "../auth/auth.module";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ROLES_KEY } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { PrismaService } from "../common/prisma.service";
import { PatientsController } from "./patients.controller";
import { PatientsModule } from "./patients.module";

// eslint-disable-next-line @typescript-eslint/ban-types
const ROUTES: Array<[string, string, string]> = [
  ["POST /patients", "create", "create_patient"],
  ["GET /patients", "search", "search_patients"],
  ["POST /patients/:id/link", "link", "link_patient"],
  ["GET /patients/:id/sessions", "sessions", "list_patient_sessions"],
];

describe("patient register routes", () => {
  it.each(ROUTES)("%s is clinician-only and audited", (_name, method, action) => {
    const handler = (PatientsController.prototype as unknown as Record<string, object>)[method];
    const onHandlerOrClass = (key: string) => Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, PatientsController);
    expect(onHandlerOrClass(GUARDS_METADATA)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(onHandlerOrClass(ROLES_KEY)).toEqual(["clinician"]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, handler)).toEqual([AuditLogInterceptor]);
    expect(Reflect.getMetadata(AUDIT_ACTION_KEY, handler)).toBe(action);
  });

  it("delegates with the signed-in clinician", async () => {
    const service = {
      create: jest.fn().mockResolvedValue({ id: "p1" }),
      search: jest.fn().mockResolvedValue([]),
      link: jest.fn().mockResolvedValue({}),
      sessions: jest.fn().mockResolvedValue([]),
    };
    const controller = new PatientsController(service as never);
    await controller.create({ name: "A", dateOfBirth: "1990-01-01" }, { user: { sub: "clin1" } });
    expect(service.create).toHaveBeenCalledWith({ name: "A", dateOfBirth: "1990-01-01" }, "clin1");
    await controller.search("ada");
    expect(service.search).toHaveBeenCalledWith("ada");
    await controller.link("p1", { subjectPseudoId: "x" });
    expect(service.link).toHaveBeenCalledWith("p1", "x");
    await controller.sessions("p1");
    expect(service.sessions).toHaveBeenCalledWith("p1");
  });
});

describe("PatientsModule", () => {
  const original = process.env.PATIENT_DATA_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.PATIENT_DATA_KEY;
    else process.env.PATIENT_DATA_KEY = original;
  });

  const compile = () =>
    Test.createTestingModule({ imports: [AuthModule, AuditLogModule, PatientsModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

  it("refuses to start without PATIENT_DATA_KEY", async () => {
    delete process.env.PATIENT_DATA_KEY;
    await expect(compile()).rejects.toThrow(/PATIENT_DATA_KEY/);
  });

  it("starts with a valid key", async () => {
    process.env.PATIENT_DATA_KEY = randomBytes(32).toString("base64");
    await expect(compile()).resolves.toBeDefined();
  });
});
