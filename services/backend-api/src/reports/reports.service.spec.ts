import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { BatteryService } from "../battery/battery.service";
import type { MetricCatalog } from "../battery/types";
import { getValidator } from "../common/schema-registry";
import { reportContentSha256 } from "./canonical-json";
import { MAX_FAILED_SIGN_OFFS, MAX_REASON_CHARS, ReportsService } from "./reports.service";

const battery = new BatteryService();
const POSTERIOR = battery.step("static.posterior")!;

const TIER: Record<string, "estimate" | "proxy"> = {
  "static.shoulder_line_tilt": "proxy",
  "static.hip_line_tilt": "proxy",
  "static.knee_frontal_alignment": "proxy",
  "static.head_shoulder_angle": "proxy",
};
const allKeys = [...new Set(battery.battery.steps.flatMap((s) => s.metricKeys))];
const unitOf = (k: string) => (k === "static.lateral_body_shift" || k.startsWith("static.plumb_offset") ? "percent_stature" : "deg");
const CATALOG: MetricCatalog = {
  metricsVersion: "metrics/v1",
  metrics: allKeys.map((metricKey) => ({
    metricKey,
    label: `Label for ${metricKey}`,
    module: "static",
    tier: TIER[metricKey] ?? "estimate",
    unit: unitOf(metricKey),
    side: null,
    signConvention: "x",
    description: "x",
  })),
  notMeasurable: [{ metricKey: "static.q_angle", label: "Q-angle", reason: "r", whatWouldBeNeeded: "w" }],
};

const provenance = {
  schemaVersion: "metric-result/v0",
  modelVersion: "mediapipe-pose-full/0.10.14",
  calibrationVersion: "none/v0",
  producedAt: "2026-10-23T10:00:00Z",
};
const at = (s: number) => new Date(Date.UTC(2026, 9, 23, 10, 0, s));
const resultFor = (metricKey: string, clipId = "c1") => ({
  resultId: `r-${clipId}-${metricKey}`,
  sessionId: "s1",
  clipId,
  stepId: "static.posterior",
  metricKey,
  module: "static",
  tier: TIER[metricKey] ?? "estimate",
  unit: unitOf(metricKey),
  side: null,
  estimate: { value: 1.5, uncertainty: 0.5, framesUsed: 100 },
  provenance,
});

interface Row {
  id: string;
  sessionId: string;
  reportVersion: number;
  status: string;
  body: any;
  signedBy: string | null;
  signedAt: Date | null;
  contentSha256: string | null;
  createdAt: Date;
}

function setup(options: { reports?: Row[]; catalogError?: Error; clips?: unknown[]; results?: unknown[]; sessionExists?: boolean } = {}) {
  const store: Row[] = [...(options.reports ?? [])];
  const prisma = {
    session: {
      findUnique: jest.fn().mockResolvedValue(options.sessionExists === false ? null : { id: "s1", state: "Observing" }),
    },
    clip: {
      findMany: jest.fn().mockResolvedValue(options.clips ?? [{ id: "c1", stepId: "static.posterior", status: "analyzed", createdAt: at(1) }]),
    },
    clinician: {
      findUnique: jest.fn().mockResolvedValue({ id: "clin1", passwordHash: bcrypt.hashSync("correct horse", 4) }),
    },
    assessmentReport: {
      findFirst: jest.fn().mockImplementation(({ where, orderBy }) => {
        let rows = store.filter((r) => (!where?.sessionId || r.sessionId === where.sessionId) && (!where?.status || r.status === where.status));
        if (orderBy?.reportVersion === "desc") rows = [...rows].sort((a, b) => b.reportVersion - a.reportVersion);
        return Promise.resolve(rows[0] ?? null);
      }),
      findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve(store.find((r) => r.id === where.id) ?? null)),
      findMany: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(
          store
            .filter((r) => !where?.status || r.status === where.status)
            .map((r) => ({ ...r, session: { state: "Observing" } }))
        )
      ),
      create: jest.fn().mockImplementation(({ data }) => {
        const row = { signedBy: null, signedAt: null, contentSha256: null, createdAt: new Date(), ...data } as Row;
        store.push(row);
        return Promise.resolve(row);
      }),
      updateMany: jest.fn().mockImplementation(({ where, data }) => {
        const row = store.find((r) => r.id === where.id && (!where.status || r.status === where.status));
        if (!row) return Promise.resolve({ count: 0 });
        Object.assign(row, data);
        return Promise.resolve({ count: 1 });
      }),
    },
  };
  const events = {
    listForSessionByType: jest
      .fn()
      .mockResolvedValue((options.results ?? POSTERIOR.metricKeys.map((k) => resultFor(k))).map((payload, i) => ({ payload, createdAt: at(i) }))),
    append: jest.fn().mockResolvedValue({}),
  };
  const ml = {
    getMetricCatalog: options.catalogError
      ? jest.fn().mockRejectedValue(options.catalogError)
      : jest.fn().mockResolvedValue(CATALOG),
  };
  const service = new ReportsService(prisma as never, events as never, battery, ml as never);
  return { service, prisma, events, ml, store };
}

const draftRow = (overrides: Partial<Row> = {}): Row => ({
  id: "rep-1",
  sessionId: "s1",
  reportVersion: 1,
  status: "draft",
  body: {
    reportId: "rep-1",
    sessionId: "s1",
    reportVersion: 1,
    supersedesReportId: null,
    status: "draft",
    rows: [
      {
        stepId: "static.posterior",
        metricKey: "static.hip_line_tilt",
        resultId: "r1",
        label: "Label",
        module: "static",
        tier: "proxy",
        unit: "deg",
        side: null,
        estimate: { value: 1, uncertainty: 0.5 },
        reference: null,
        position: "no_reference",
        analysis: { text: "1.0° ± 0.5°. No reference value is set for this measurement.", source: "fixed_template", templateId: "proxy.no_reference" },
        excluded: null,
      },
    ],
    notMeasurable: CATALOG.notMeasurable,
    clinicianAssessment: null,
    signOff: null,
    provenance: { schemaVersion: "assessment-report/v0", modelVersion: "report-builder/v1", calibrationVersion: "none/v0", producedAt: "2026-10-23T10:00:00.000Z" },
  },
  signedBy: null,
  signedAt: null,
  contentSha256: null,
  createdAt: at(10),
  ...overrides,
});

describe("ReportsService.build", () => {
  it("builds draft v1 from the session's analysed results and stores a schema-valid body", async () => {
    const { service, store } = setup();
    const body = await service.build("s1", "clin1");
    expect(body.reportVersion).toBe(1);
    expect(body.supersedesReportId).toBeNull();
    expect(body.status).toBe("draft");
    expect(body.rows).toHaveLength(POSTERIOR.metricKeys.length);
    expect(getValidator("assessment-report")(body)).toBe(true);
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({ id: body.reportId, sessionId: "s1", reportVersion: 1, status: "draft" });
  });

  it("builds vN+1 superseding the previous report", async () => {
    const { service } = setup({ reports: [draftRow({ id: "rep-1", reportVersion: 1 }), draftRow({ id: "rep-2", reportVersion: 2, status: "rejected" })] });
    const body = await service.build("s1", "clin1");
    expect(body.reportVersion).toBe(3);
    expect(body.supersedesReportId).toBe("rep-2");
  });

  it("is 503, and stores nothing, when the ml catalog is unavailable (no label is invented)", async () => {
    const { service, store } = setup({ catalogError: new ServiceUnavailableException("down") });
    await expect(service.build("s1", "clin1")).rejects.toThrow(ServiceUnavailableException);
    expect(store).toHaveLength(0);
  });

  it("is 404 for an unknown session", async () => {
    const { service } = setup({ sessionExists: false });
    await expect(service.build("nope", "clin1")).rejects.toThrow(NotFoundException);
  });

  it("is 409 when no clip has been analysed yet", async () => {
    const { service, store } = setup({ clips: [{ id: "c1", stepId: "static.posterior", status: "uploaded", createdAt: at(1) }], results: [] });
    await expect(service.build("s1", "clin1")).rejects.toThrow(ConflictException);
    expect(store).toHaveLength(0);
  });

  it("is 422 when the results disagree with the catalog", async () => {
    const results = [{ ...resultFor(POSTERIOR.metricKeys[0]), unit: "rad" }];
    const { service, store } = setup({ results });
    await expect(service.build("s1", "clin1")).rejects.toThrow(UnprocessableEntityException);
    expect(store).toHaveLength(0);
  });

  it("answers 409 when another clinician built the same version first", async () => {
    const { service, prisma } = setup();
    prisma.assessmentReport.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    await expect(service.build("s1", "clin1")).rejects.toThrow(ConflictException);
  });
});

describe("ReportsService.preview", () => {
  it("returns the rows a draft would contain and stores nothing", async () => {
    const { service, store, prisma } = setup();
    const body = await service.preview("s1");
    expect(body.rows).toHaveLength(POSTERIOR.metricKeys.length);
    expect(getValidator("assessment-report")(body)).toBe(true);
    expect(store).toHaveLength(0);
    expect(prisma.assessmentReport.create).not.toHaveBeenCalled();
  });

  it("can be called repeatedly without moving the report version", async () => {
    const { service, store } = setup({ reports: [draftRow({ id: "rep-1", reportVersion: 1 })] });
    await service.preview("s1");
    const again = await service.preview("s1");
    expect(again.reportVersion).toBe(2);
    expect(store).toHaveLength(1);
  });

  it("is 409 when no clip has been analysed yet, like build", async () => {
    const { service } = setup({ clips: [{ id: "c1", stepId: "static.posterior", status: "uploaded", createdAt: at(1) }], results: [] });
    await expect(service.preview("s1")).rejects.toThrow(ConflictException);
  });
});

describe("ReportsService.list and get", () => {
  it("lists summaries with the session's safety state", async () => {
    const { service } = setup({ reports: [draftRow()] });
    await expect(service.list("draft")).resolves.toEqual([
      expect.objectContaining({ reportId: "rep-1", sessionId: "s1", reportVersion: 1, status: "draft", sessionState: "Observing" }),
    ]);
  });

  it("filters by status and refuses an unknown status", async () => {
    const { service, prisma } = setup({ reports: [draftRow()] });
    await service.list("released");
    expect(prisma.assessmentReport.findMany.mock.calls[0][0].where).toEqual({ status: "released" });
    await expect(service.list("rejected")).rejects.toThrow(BadRequestException);
  });

  it("returns the report body, or 404", async () => {
    const { service } = setup({ reports: [draftRow()] });
    await expect(service.get("rep-1")).resolves.toMatchObject({ reportId: "rep-1" });
    await expect(service.get("nope")).rejects.toThrow(NotFoundException);
  });
});

describe("ReportsService.excludeRow", () => {
  const target = { metricKey: "static.hip_line_tilt", side: null, stepId: "static.posterior" };

  it("marks the matching row excluded with the reason and clinician, keeping the row", async () => {
    const { service, store } = setup({ reports: [draftRow()] });
    const body = await service.excludeRow("rep-1", "clin1", { ...target, reason: "Subject moved" });
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].excluded).toEqual({ reason: "Subject moved", clinicianId: "clin1" });
    expect(store[0].body.rows[0].excluded).toEqual({ reason: "Subject moved", clinicianId: "clin1" });
  });

  it("requires a non-blank reason", async () => {
    const { service } = setup({ reports: [draftRow()] });
    await expect(service.excludeRow("rep-1", "clin1", { ...target, reason: "   " })).rejects.toThrow(BadRequestException);
  });

  it("refuses an exclusion reason longer than the cap", async () => {
    const { service } = setup({ reports: [draftRow()] });
    await expect(service.excludeRow("rep-1", "clin1", { ...target, reason: "x".repeat(MAX_REASON_CHARS + 1) })).rejects.toThrow(BadRequestException);
  });

  it("is 404 when no row matches", async () => {
    const { service } = setup({ reports: [draftRow()] });
    await expect(service.excludeRow("rep-1", "clin1", { ...target, stepId: "static.anterior", reason: "x" })).rejects.toThrow(NotFoundException);
  });

  it("is refused once the report is no longer a draft", async () => {
    const { service } = setup({ reports: [draftRow({ status: "released" })] });
    await expect(service.excludeRow("rep-1", "clin1", { ...target, reason: "x" })).rejects.toThrow(ConflictException);
  });
});

describe("ReportsService.setAssessment", () => {
  it("stores the clinician's text with their id", async () => {
    const { service } = setup({ reports: [draftRow()] });
    const body = await service.setAssessment("rep-1", "clin1", "  My own reading of these figures.  ");
    expect(body.clinicianAssessment).toEqual({ text: "My own reading of these figures.", clinicianId: "clin1" });
  });

  it("clears the assessment when the text is blank", async () => {
    const { service } = setup({ reports: [draftRow()] });
    const body = await service.setAssessment("rep-1", "clin1", "   ");
    expect(body.clinicianAssessment).toBeNull();
  });

  it("rejects non-string text and overlong text", async () => {
    const { service } = setup({ reports: [draftRow()] });
    await expect(service.setAssessment("rep-1", "clin1", 5 as never)).rejects.toThrow(BadRequestException);
    await expect(service.setAssessment("rep-1", "clin1", "x".repeat(10001))).rejects.toThrow(BadRequestException);
  });

  it("is refused once released", async () => {
    const { service } = setup({ reports: [draftRow({ status: "released" })] });
    await expect(service.setAssessment("rep-1", "clin1", "hello")).rejects.toThrow(ConflictException);
  });
});

describe("ReportsService.signOff", () => {
  it("re-verifies the password, releases the report and stores the sha256 of its canonical body", async () => {
    const { service, store } = setup({ reports: [draftRow()] });
    const body = await service.signOff("rep-1", "clin1", "correct horse");

    expect(body.status).toBe("released");
    expect(body.signOff).toMatchObject({ clinicianId: "clin1" });
    expect(body.signOff!.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.signOff!.contentSha256).toBe(reportContentSha256(body as never));
    expect(getValidator("assessment-report")(body)).toBe(true);
    expect(store[0]).toMatchObject({ status: "released", signedBy: "clin1", contentSha256: body.signOff!.contentSha256 });
    expect(store[0].signedAt).toBeInstanceOf(Date);
    expect(store[0].body).toEqual(body);
  });

  it("refuses a wrong password and leaves the draft untouched", async () => {
    const { service, store } = setup({ reports: [draftRow()] });
    await expect(service.signOff("rep-1", "clin1", "wrong")).rejects.toThrow(ForbiddenException);
    expect(store[0].status).toBe("draft");
    expect(store[0].body.signOff).toBeNull();
  });

  it("requires a password", async () => {
    const { service } = setup({ reports: [draftRow()] });
    await expect(service.signOff("rep-1", "clin1", "")).rejects.toThrow(BadRequestException);
    await expect(service.signOff("rep-1", "clin1", undefined as never)).rejects.toThrow(BadRequestException);
  });

  it("refuses when the clinician account no longer exists", async () => {
    const { service, prisma } = setup({ reports: [draftRow()] });
    prisma.clinician.findUnique.mockResolvedValue(null);
    await expect(service.signOff("rep-1", "clin1", "correct horse")).rejects.toThrow(ForbiddenException);
  });

  it("cannot sign a report twice", async () => {
    const { service } = setup({ reports: [draftRow()] });
    await service.signOff("rep-1", "clin1", "correct horse");
    await expect(service.signOff("rep-1", "clin1", "correct horse")).rejects.toThrow(ConflictException);
  });

  it("answers 409 when the draft was released or rejected while the password was being checked", async () => {
    const { service, prisma } = setup({ reports: [draftRow()] });
    prisma.assessmentReport.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.signOff("rep-1", "clin1", "correct horse")).rejects.toThrow(ConflictException);
  });

  it("signs off successfully when the caller's contentSha256/reportVersion match the current draft", async () => {
    const row = draftRow();
    const { service } = setup({ reports: [row] });
    const expectedSha = reportContentSha256(row.body as never);
    const body = await service.signOff("rep-1", "clin1", "correct horse", expectedSha, row.reportVersion);
    expect(body.status).toBe("released");
  });

  it("409s when the caller's contentSha256 no longer matches (someone else changed the draft first)", async () => {
    const row = draftRow();
    const { service, store } = setup({ reports: [row] });
    const staleSha = reportContentSha256(row.body as never);
    // Someone else excludes a row first, changing the stored draft's content.
    await service.excludeRow("rep-1", "clin2", {
      metricKey: "static.hip_line_tilt",
      side: null,
      stepId: "static.posterior",
      reason: "Subject moved",
    });
    await expect(service.signOff("rep-1", "clin1", "correct horse", staleSha, row.reportVersion)).rejects.toThrow(ConflictException);
    expect(store[0].status).toBe("draft");
  });

  it("409s when the caller's reportVersion no longer matches", async () => {
    const row = draftRow();
    const { service } = setup({ reports: [row] });
    const currentSha = reportContentSha256(row.body as never);
    await expect(service.signOff("rep-1", "clin1", "correct horse", currentSha, row.reportVersion + 1)).rejects.toThrow(ConflictException);
  });

  it("still signs off with no contentSha256/reportVersion supplied at all (back-compat: an older client)", async () => {
    const { service } = setup({ reports: [draftRow()] });
    const body = await service.signOff("rep-1", "clin1", "correct horse");
    expect(body.status).toBe("released");
  });
});

describe("ReportsService.reject", () => {
  it("marks the draft rejected and logs the reason as a bookkeeping event with its own schema id and provenance", async () => {
    const { service, store, events } = setup({ reports: [draftRow()] });
    const body = await service.reject("rep-1", "clin1", "Clip was taken in the wrong room");
    expect(body.status).toBe("rejected");
    expect(store[0].status).toBe("rejected");
    expect(events.append).toHaveBeenCalledTimes(1);
    const [sessionId, type, schemaId, payload] = events.append.mock.calls[0];
    expect(sessionId).toBe("s1");
    expect(type).toBe("report_rejected");
    expect(schemaId).toBe("report-rejection/v0");
    expect(payload).toMatchObject({
      reportId: "rep-1",
      clinicianId: "clin1",
      reason: "Clip was taken in the wrong room",
      provenance: { schemaVersion: "report-rejection/v0", modelVersion: expect.any(String), calibrationVersion: "none/v0" },
    });
    expect(Number.isNaN(Date.parse(payload.provenance.producedAt))).toBe(false);
  });

  it("refuses a reason longer than the cap and leaves the draft untouched", async () => {
    const { service, store } = setup({ reports: [draftRow()] });
    await expect(service.reject("rep-1", "clin1", "x".repeat(MAX_REASON_CHARS + 1))).rejects.toThrow(BadRequestException);
    expect(store[0].status).toBe("draft");
  });

  it("still answers success when the bookkeeping event cannot be written after the report is rejected", async () => {
    const { service, store, events } = setup({ reports: [draftRow()] });
    events.append.mockRejectedValue(new Error("db down"));
    await expect(service.reject("rep-1", "clin1", "wrong room")).resolves.toMatchObject({ status: "rejected" });
    expect(store[0].status).toBe("rejected");
  });

  it("requires a reason and a draft", async () => {
    const { service } = setup({ reports: [draftRow(), draftRow({ id: "rep-2", reportVersion: 2, status: "released" })] });
    await expect(service.reject("rep-1", "clin1", " ")).rejects.toThrow(BadRequestException);
    await expect(service.reject("rep-2", "clin1", "why")).rejects.toThrow(ConflictException);
  });
});

describe("ReportsService.signOff attempt limit", () => {
  it("locks sign-off for the clinician after repeated wrong passwords, even for the right password", async () => {
    const { service, store } = setup({ reports: [draftRow()] });
    for (let i = 0; i < MAX_FAILED_SIGN_OFFS; i++) {
      await expect(service.signOff("rep-1", "clin1", "wrong")).rejects.toThrow(ForbiddenException);
    }
    const error = await service.signOff("rep-1", "clin1", "correct horse").catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(429);
    expect(store[0].status).toBe("draft");
  });

  it("does not lock out a different clinician, and a success clears the count", async () => {
    const { service, prisma } = setup({ reports: [draftRow(), draftRow({ id: "rep-2", reportVersion: 2 })] });
    for (let i = 0; i < MAX_FAILED_SIGN_OFFS - 1; i++) {
      await expect(service.signOff("rep-1", "clin1", "wrong")).rejects.toThrow(ForbiddenException);
    }
    await expect(service.signOff("rep-1", "clin1", "correct horse")).resolves.toMatchObject({ status: "released" });
    for (let i = 0; i < MAX_FAILED_SIGN_OFFS - 1; i++) {
      await expect(service.signOff("rep-2", "clin1", "wrong")).rejects.toThrow(ForbiddenException);
    }
    prisma.clinician.findUnique.mockResolvedValue({ id: "clin2", passwordHash: bcrypt.hashSync("other", 4) });
    await expect(service.signOff("rep-2", "clin2", "other")).resolves.toMatchObject({ status: "released" });
  });

  it("forgets failures after the lockout window", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    try {
      const { service } = setup({ reports: [draftRow()] });
      for (let i = 0; i < MAX_FAILED_SIGN_OFFS; i++) {
        await expect(service.signOff("rep-1", "clin1", "wrong")).rejects.toThrow(ForbiddenException);
      }
      jest.setSystemTime(Date.now() + 16 * 60 * 1000);
      await expect(service.signOff("rep-1", "clin1", "correct horse")).resolves.toMatchObject({ status: "released" });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("ReportsService.verifyReferences", () => {
  it("passes for the shipped reference set and the test catalog", async () => {
    const { service } = setup();
    await expect(service.verifyReferences()).resolves.toEqual({ checked: true });
  });

  it("reports a bad reference set (a literature reference for a proxy) without throwing", async () => {
    const entry = battery.referenceSet.entries.find((e) => TIER[e.metricKey] === "proxy")!;
    const badBattery = {
      battery: battery.battery,
      referenceSet: { ...battery.referenceSet, entries: [{ ...entry, kind: "literature" }] },
    };
    const { ml, prisma, events } = setup();
    const bad = new ReportsService(prisma as never, events as never, badBattery as never, ml as never);
    const result = await bad.verifyReferences();
    expect(result.checked).toBe(false);
    expect((result as { error: string }).error).toMatch(/proxy/);
  });

  it("does not throw when ml-service is not reachable at startup", async () => {
    const { service } = setup({ catalogError: new ServiceUnavailableException("down") });
    await expect(service.verifyReferences()).resolves.toEqual({ checked: false, error: expect.stringContaining("down") });
  });
});

describe("ReportsService.latestReleased", () => {
  it("leaves out rows the clinician excluded, so withdrawn measurements never reach the patient", async () => {
    const base = draftRow().body;
    const keep = { ...base.rows[0], metricKey: "static.shoulder_line_tilt" };
    const drop = { ...base.rows[0], excluded: { reason: "Subject moved", clinicianId: "clin1" } };
    const { service, store } = setup({
      reports: [draftRow({ id: "a", status: "released", body: { ...base, reportId: "a", status: "released", rows: [keep, drop] } })],
    });
    const out = await service.latestReleased("s1");
    expect(out!.rows.map((r) => r.metricKey)).toEqual(["static.shoulder_line_tilt"]);
    // the stored, signed body is untouched
    expect(store[0].body.rows).toHaveLength(2);
    expect(out!.signOff).toEqual(base.signOff);
  });

  it("returns the highest released version for the session", async () => {
    const { service } = setup({
      reports: [
        draftRow({ id: "a", reportVersion: 1, status: "released", body: { ...draftRow().body, reportId: "a", status: "released" } }),
        draftRow({ id: "b", reportVersion: 2, status: "released", body: { ...draftRow().body, reportId: "b", status: "released" } }),
        draftRow({ id: "c", reportVersion: 3, status: "draft", body: { ...draftRow().body, reportId: "c" } }),
      ],
    });
    await expect(service.latestReleased("s1")).resolves.toMatchObject({ reportId: "b" });
  });

  it("returns null when nothing was released", async () => {
    const { service } = setup({ reports: [draftRow()] });
    await expect(service.latestReleased("s1")).resolves.toBeNull();
  });
});
