import "reflect-metadata";
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from "@nestjs/common/constants";
import { NotFoundException } from "@nestjs/common";
import { AUDIT_ACTION_KEY } from "../audit/audit-action.decorator";
import { AuditLogInterceptor } from "../audit/audit-log.interceptor";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ReportReaderGuard } from "../auth/report-reader.guard";
import { ROLES_KEY } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { SessionOwnershipGuard } from "../auth/session-ownership.guard";
import { ReportsController, SessionReportsController } from "./reports.controller";

const clinicianReq = { user: { sub: "clin1", username: "dr", role: "clinician" } };

// eslint-disable-next-line @typescript-eslint/ban-types
const CLINICIAN_ROUTES: Array<[string, Function, string, string]> = [
  ["POST /sessions/:id/report", SessionReportsController, "build", "build_report"],
  ["GET /reports", ReportsController, "list", "list_reports"],
  ["GET /reports/:id", ReportsController, "get", "view_report"],
  ["POST /reports/:id/rows/exclude", ReportsController, "exclude", "exclude_report_row"],
  ["POST /reports/:id/assessment", ReportsController, "assess", "write_report_assessment"],
  ["POST /reports/:id/sign-off", ReportsController, "signOff", "sign_off_report"],
  ["POST /reports/:id/reject", ReportsController, "reject", "reject_report"],
];

describe("clinician report routes", () => {
  it.each(CLINICIAN_ROUTES)("%s needs a clinician token and is audited as %s", (_name, controller, method, action) => {
    const handler = (controller.prototype as Record<string, object>)[method];
    // Guards and roles may sit on the handler or on the whole controller.
    const onHandlerOrClass = (key: string) => Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller);
    expect(onHandlerOrClass(GUARDS_METADATA)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(onHandlerOrClass(ROLES_KEY)).toEqual(["clinician"]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, handler)).toEqual([AuditLogInterceptor]);
    expect(Reflect.getMetadata(AUDIT_ACTION_KEY, handler)).toBe(action);
  });

  it("delegates with the signed-in clinician's id", async () => {
    const service = {
      build: jest.fn().mockResolvedValue({ reportId: "r1" }),
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue({}),
      excludeRow: jest.fn().mockResolvedValue({}),
      setAssessment: jest.fn().mockResolvedValue({}),
      signOff: jest.fn().mockResolvedValue({}),
      reject: jest.fn().mockResolvedValue({}),
    };
    const reports = new ReportsController(service as never);
    const sessionReports = new SessionReportsController(service as never, {} as never);

    await sessionReports.build("s1", clinicianReq);
    expect(service.build).toHaveBeenCalledWith("s1", "clin1");
    await reports.list("draft");
    expect(service.list).toHaveBeenCalledWith("draft");
    await reports.get("r1");
    expect(service.get).toHaveBeenCalledWith("r1");
    await reports.exclude("r1", { metricKey: "k", side: null, stepId: "s", reason: "why" }, clinicianReq);
    expect(service.excludeRow).toHaveBeenCalledWith("r1", "clin1", { metricKey: "k", side: null, stepId: "s", reason: "why" });
    await reports.assess("r1", { text: "t" }, clinicianReq);
    expect(service.setAssessment).toHaveBeenCalledWith("r1", "clin1", "t");
    await reports.signOff("r1", { password: "pw" }, clinicianReq);
    expect(service.signOff).toHaveBeenCalledWith("r1", "clin1", "pw", undefined, undefined);
    await reports.reject("r1", { reason: "no" }, clinicianReq);
    expect(service.reject).toHaveBeenCalledWith("r1", "clin1", "no");
  });
});

describe("patient report routes", () => {
  it("POST /sessions/:id/report-access needs the subject token for that session", () => {
    const handler = SessionReportsController.prototype.reportAccess;
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, SessionOwnershipGuard]);
  });

  it("GET /sessions/:id/released-report is guarded by the report-reader guard only", () => {
    const handler = SessionReportsController.prototype.releasedReport;
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([ReportReaderGuard]);
  });

  it("issues a report-access token for the subject of the token's session", async () => {
    const subjectAuth = { issueReportAccessToken: jest.fn().mockResolvedValue("tok") };
    const controller = new SessionReportsController({} as never, subjectAuth as never);
    await expect(controller.reportAccess("s1", { user: { sub: "p1" } })).resolves.toEqual({
      reportAccessToken: "tok",
    });
    expect(subjectAuth.issueReportAccessToken).toHaveBeenCalledWith("s1", "p1");
  });

  it("returns the latest released report", async () => {
    const service = { latestReleased: jest.fn().mockResolvedValue({ reportId: "r2", status: "released" }) };
    const controller = new SessionReportsController(service as never, {} as never);
    await expect(controller.releasedReport("s1")).resolves.toEqual({ reportId: "r2", status: "released" });
  });

  it("answers 404 {status: pending_review} while nothing is released", async () => {
    const service = { latestReleased: jest.fn().mockResolvedValue(null) };
    const controller = new SessionReportsController(service as never, {} as never);
    const error = await controller.releasedReport("s1").catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toEqual({ status: "pending_review" });
  });
});
