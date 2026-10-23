import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { BatteryService } from "../battery/battery.service";
import { PrismaService } from "../common/prisma.service";
import { getValidator } from "../common/schema-registry";
import { EventsService } from "../events/events.service";
import { MlClientService } from "../ml-integration/ml-client.service";
import { reportContentSha256 } from "./canonical-json";
import { AssessmentReportBody, REPORT_BUILDER_VERSION, ReportBuildError, buildReport, indexReferences, selectResultsForReport } from "./report-builder";

export const MAX_ASSESSMENT_CHARS = 10000;
/** Cap on the clinician's free-text reason for excluding a row or rejecting a report. */
export const MAX_REASON_CHARS = 1000;
/** Sign-off password attempts allowed per clinician within SIGN_OFF_LOCK_MS before further attempts are refused. */
export const MAX_FAILED_SIGN_OFFS = 5;
export const SIGN_OFF_LOCK_MS = 15 * 60 * 1000;
export const REJECTION_SCHEMA_ID = "report-rejection/v0";
const LIST_LIMIT = 200;

export interface ReportSummary {
  reportId: string;
  id: string;
  sessionId: string;
  reportVersion: number;
  status: string;
  createdAt: Date;
  signedAt: Date | null;
  sessionState: string | null;
}

export interface RowSelector {
  metricKey: string;
  side?: string | null;
  stepId?: string | null;
  reason: string;
}

interface ReportRecord {
  id: string;
  sessionId: string;
  reportVersion: number;
  status: string;
  body: unknown;
}

/**
 * Clinician-side report workflow (ADR-015): build a draft from the session's
 * analysed results, let the reviewing clinician exclude rows and write their
 * own assessment, then release (password re-verified, content hashed) or
 * reject. Rows are written by the deterministic builder only; nothing here
 * writes interpretation text except the clinician's own.
 */
@Injectable()
export class ReportsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReportsService.name);
  /** clinicianId -> times of recent wrong sign-off passwords (in memory: the backend runs as one instance, ADR-015). */
  private readonly failedSignOffs = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly battery: BatteryService,
    private readonly ml: MlClientService
  ) {}

  /** Not awaited: startup must not wait for ml-service. */
  onApplicationBootstrap(): void {
    void this.verifyReferences().then((result) => {
      if (!result.checked) {
        this.logger.warn(`Reference set not checked against the metric catalog at startup: ${result.error}. It is checked on every report build.`);
      }
    });
  }

  /**
   * Checks the reference set against ml-service's metric catalog (unknown
   * metric, unit mismatch, literature reference for a proxy). The tier comes
   * from the catalog, so this cannot run before ml-service answers; it never
   * throws, and buildReport repeats the same check on every build.
   */
  async verifyReferences(): Promise<{ checked: true } | { checked: false; error: string }> {
    try {
      const catalog = await this.ml.getMetricCatalog();
      indexReferences(this.battery.referenceSet, catalog);
      return { checked: true };
    } catch (error) {
      return { checked: false, error: (error as Error).message };
    }
  }

  async build(sessionId: string, _clinicianId: string): Promise<AssessmentReportBody> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found.`);

    const clips = await this.prisma.clip.findMany({ where: { sessionId } });
    const resultEvents = await this.events.listForSessionByType(sessionId, "metric-result");
    const results = selectResultsForReport(
      resultEvents.map((e) => ({ payload: e.payload, createdAt: e.createdAt })),
      clips
    );
    if (results.length === 0) {
      throw new ConflictException("No analysed clip for this session yet; there is nothing to report.");
    }

    // 503 when ml-service cannot describe the metrics: labels are never made up here.
    const catalog = await this.ml.getMetricCatalog();

    const previous = await this.prisma.assessmentReport.findFirst({ where: { sessionId }, orderBy: { reportVersion: "desc" } });
    const reportId = uuid();
    const reportVersion = (previous?.reportVersion ?? 0) + 1;

    let body: AssessmentReportBody;
    try {
      body = buildReport({
        reportId,
        sessionId,
        reportVersion,
        supersedesReportId: previous?.id ?? null,
        producedAt: new Date().toISOString(),
        battery: this.battery.battery,
        results,
        referenceSet: this.battery.referenceSet,
        catalog,
      });
    } catch (error) {
      if (error instanceof ReportBuildError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
    this.assertValid(body);

    try {
      await this.prisma.assessmentReport.create({
        data: { id: reportId, sessionId, reportVersion, status: "draft", body: body as unknown as object },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw new ConflictException("Another report version was built at the same time; try again.");
      }
      throw error;
    }
    return body;
  }

  async list(status?: string): Promise<ReportSummary[]> {
    if (status !== undefined && status !== "draft" && status !== "released") {
      throw new BadRequestException("status must be 'draft' or 'released'.");
    }
    const rows = await this.prisma.assessmentReport.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT,
      include: { session: { select: { state: true } } },
    });
    return rows.map((r) => ({
      reportId: r.id,
      id: r.id,
      sessionId: r.sessionId,
      reportVersion: r.reportVersion,
      status: r.status,
      createdAt: r.createdAt,
      signedAt: r.signedAt,
      sessionState: r.session?.state ?? null,
    }));
  }

  async get(reportId: string): Promise<AssessmentReportBody> {
    return (await this.load(reportId)).body as AssessmentReportBody;
  }

  async latestReleased(sessionId: string): Promise<AssessmentReportBody | null> {
    const row = await this.prisma.assessmentReport.findFirst({
      where: { sessionId, status: "released" },
      orderBy: { reportVersion: "desc" },
    });
    if (!row) return null;
    // The patient sees the signed report without the rows the clinician withdrew. The stored body (and
    // signOff.contentSha256, computed over it) is unchanged; the clinician's GET /reports/:id serves it whole.
    const body = row.body as unknown as AssessmentReportBody;
    return { ...body, rows: body.rows.filter((r) => !r.excluded) };
  }

  async excludeRow(reportId: string, clinicianId: string, selector: RowSelector): Promise<AssessmentReportBody> {
    const reason = typeof selector.reason === "string" ? selector.reason.trim() : "";
    if (!reason) throw new BadRequestException("A reason is required to exclude a row.");
    if (reason.length > MAX_REASON_CHARS) throw new BadRequestException(`reason is longer than ${MAX_REASON_CHARS} characters.`);
    if (typeof selector.metricKey !== "string" || !selector.metricKey) throw new BadRequestException("metricKey is required.");
    const side = selector.side ?? null;
    const stepId = selector.stepId ?? null;

    return this.mutateDraft(reportId, (body) => {
      const row = body.rows.find((r) => r.metricKey === selector.metricKey && (r.side ?? null) === side && (r.stepId ?? null) === stepId);
      if (!row) throw new NotFoundException("No row in this report matches metricKey, side and stepId.");
      row.excluded = { reason, clinicianId };
    });
  }

  async setAssessment(reportId: string, clinicianId: string, text: string): Promise<AssessmentReportBody> {
    if (typeof text !== "string") throw new BadRequestException("text must be a string.");
    if (text.length > MAX_ASSESSMENT_CHARS) throw new BadRequestException(`text is longer than ${MAX_ASSESSMENT_CHARS} characters.`);
    const trimmed = text.trim();
    return this.mutateDraft(reportId, (body) => {
      body.clinicianAssessment = trimmed ? { text: trimmed, clinicianId } : null;
    });
  }

  /**
   * Releases a draft. The clinician's password is checked again here (a token
   * left open on a shared screen must not be enough to sign). contentSha256 is
   * reportContentSha256 of the released body, so it can be recomputed later.
   */
  async signOff(
    reportId: string,
    clinicianId: string,
    password: string,
    expectedContentSha256?: string,
    expectedReportVersion?: number
  ): Promise<AssessmentReportBody> {
    if (typeof password !== "string" || password.length === 0) throw new BadRequestException("password is required.");
    const row = await this.load(reportId);
    this.assertDraft(row.status);
    this.assertNotLocked(clinicianId);

    if (expectedContentSha256 !== undefined || expectedReportVersion !== undefined) {
      const currentBody = row.body as unknown as AssessmentReportBody;
      const currentSha = reportContentSha256(currentBody as never);
      if (
        (expectedContentSha256 !== undefined && expectedContentSha256 !== currentSha) ||
        (expectedReportVersion !== undefined && expectedReportVersion !== currentBody.reportVersion)
      ) {
        throw new ConflictException("This report changed since you last reviewed it. Reload and try again.");
      }
    }

    const clinician = await this.prisma.clinician.findUnique({ where: { id: clinicianId } });
    // Compare even when the account is gone so both failures cost the same.
    const hash = clinician?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali";
    const matches = await bcrypt.compare(password, hash);
    if (!clinician || !matches) {
      this.recordFailedSignOff(clinicianId);
      throw new ForbiddenException("The password did not match.");
    }
    this.failedSignOffs.delete(clinicianId);

    const signedAt = new Date();
    const body = structuredClone(row.body) as AssessmentReportBody;
    body.status = "released";
    body.signOff = { clinicianId, signedAt: signedAt.toISOString(), contentSha256: "" };
    body.signOff.contentSha256 = reportContentSha256(body as never);
    this.assertValid(body);

    const updated = await this.prisma.assessmentReport.updateMany({
      where: { id: reportId, status: "draft" },
      data: { status: "released", body: body as unknown as object, signedBy: clinicianId, signedAt, contentSha256: body.signOff.contentSha256 },
    });
    if (updated.count === 0) throw new ConflictException("The report is no longer a draft.");
    return body;
  }

  async reject(reportId: string, clinicianId: string, reason: string): Promise<AssessmentReportBody> {
    const trimmed = typeof reason === "string" ? reason.trim() : "";
    if (!trimmed) throw new BadRequestException("A reason is required to reject a report.");
    if (trimmed.length > MAX_REASON_CHARS) throw new BadRequestException(`reason is longer than ${MAX_REASON_CHARS} characters.`);
    const row = await this.load(reportId);
    this.assertDraft(row.status);

    const body = structuredClone(row.body) as AssessmentReportBody;
    body.status = "rejected";
    const updated = await this.prisma.assessmentReport.updateMany({
      where: { id: reportId, status: "draft" },
      data: { status: "rejected", body: body as unknown as object },
    });
    if (updated.count === 0) throw new ConflictException("The report is no longer a draft.");
    // Bookkeeping event (not a measurement, not an assessment-report): why the draft was withdrawn. The reason is
    // clinician free text, so the research export leaves this event type out. The report is already rejected at
    // this point, so a failure to log must not turn the answer into a 500.
    try {
      await this.events.append(row.sessionId, "report_rejected", REJECTION_SCHEMA_ID, {
        reportId,
        clinicianId,
        reason: trimmed,
        provenance: {
          schemaVersion: REJECTION_SCHEMA_ID,
          modelVersion: REPORT_BUILDER_VERSION,
          calibrationVersion: "none/v0",
          producedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      this.logger.error(`Report ${reportId} was rejected but the report_rejected event could not be written: ${(error as Error).message}`);
    }
    return body;
  }

  private recentFailures(clinicianId: string): number[] {
    const cutoff = Date.now() - SIGN_OFF_LOCK_MS;
    const recent = (this.failedSignOffs.get(clinicianId) ?? []).filter((t) => t > cutoff);
    if (recent.length > 0) this.failedSignOffs.set(clinicianId, recent);
    else this.failedSignOffs.delete(clinicianId);
    return recent;
  }

  private assertNotLocked(clinicianId: string): void {
    if (this.recentFailures(clinicianId).length >= MAX_FAILED_SIGN_OFFS) {
      throw new HttpException("Too many wrong passwords for sign-off; try again in 15 minutes.", 429);
    }
  }

  private recordFailedSignOff(clinicianId: string): void {
    this.failedSignOffs.set(clinicianId, [...this.recentFailures(clinicianId), Date.now()]);
  }

  private async mutateDraft(reportId: string, change: (body: AssessmentReportBody) => void): Promise<AssessmentReportBody> {
    const row = await this.load(reportId);
    this.assertDraft(row.status);
    const body = structuredClone(row.body) as AssessmentReportBody;
    change(body);
    this.assertValid(body);
    const updated = await this.prisma.assessmentReport.updateMany({
      where: { id: reportId, status: "draft" },
      data: { body: body as unknown as object },
    });
    if (updated.count === 0) throw new ConflictException("The report is no longer a draft.");
    return body;
  }

  private async load(reportId: string): Promise<ReportRecord> {
    const row = await this.prisma.assessmentReport.findUnique({ where: { id: reportId } });
    if (!row) throw new NotFoundException(`Report ${reportId} not found.`);
    return row as ReportRecord;
  }

  private assertDraft(status: string): void {
    if (status !== "draft") throw new ConflictException(`The report is ${status}; only a draft can be changed.`);
  }

  private assertValid(body: AssessmentReportBody): void {
    const validate = getValidator("assessment-report");
    if (!validate(body)) {
      throw new UnprocessableEntityException({ message: "The report does not conform to assessment-report.", errors: validate.errors });
    }
  }
}
