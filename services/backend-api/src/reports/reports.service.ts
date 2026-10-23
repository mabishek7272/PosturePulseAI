import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
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
import { AssessmentReportBody, ReportBuildError, buildReport, selectResultsForReport } from "./report-builder";

export const MAX_ASSESSMENT_CHARS = 10000;
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
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly battery: BatteryService,
    private readonly ml: MlClientService
  ) {}

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
    return row ? (row.body as unknown as AssessmentReportBody) : null;
  }

  async excludeRow(reportId: string, clinicianId: string, selector: RowSelector): Promise<AssessmentReportBody> {
    const reason = typeof selector.reason === "string" ? selector.reason.trim() : "";
    if (!reason) throw new BadRequestException("A reason is required to exclude a row.");
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
  async signOff(reportId: string, clinicianId: string, password: string): Promise<AssessmentReportBody> {
    if (typeof password !== "string" || password.length === 0) throw new BadRequestException("password is required.");
    const row = await this.load(reportId);
    this.assertDraft(row.status);

    const clinician = await this.prisma.clinician.findUnique({ where: { id: clinicianId } });
    // Compare even when the account is gone so both failures cost the same.
    const hash = clinician?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali";
    const matches = await bcrypt.compare(password, hash);
    if (!clinician || !matches) throw new ForbiddenException("The password did not match.");

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
    const row = await this.load(reportId);
    this.assertDraft(row.status);

    const body = structuredClone(row.body) as AssessmentReportBody;
    body.status = "rejected";
    const updated = await this.prisma.assessmentReport.updateMany({
      where: { id: reportId, status: "draft" },
      data: { status: "rejected", body: body as unknown as object },
    });
    if (updated.count === 0) throw new ConflictException("The report is no longer a draft.");
    // Bookkeeping event (not a measurement): why the draft was withdrawn.
    await this.events.append(row.sessionId, "report_rejected", "assessment-report/v0", { reportId, clinicianId, reason: trimmed });
    return body;
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
