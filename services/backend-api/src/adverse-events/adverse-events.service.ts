import { BadRequestException, Injectable } from "@nestjs/common";
import { v4 as uuid } from "uuid";
import { getValidator } from "../common/schema-registry";
import { PrismaService } from "../common/prisma.service";

export interface CreateAdverseEventInput {
  sessionId?: string | null;
  subjectPseudoId: string;
  reportedByClinicianId: string;
  relatedSymptomReportId?: string | null;
  onsetAt: string;
  description: string;
  severity: "mild" | "moderate" | "severe";
  serious: boolean;
  causality: "unrelated" | "unlikely" | "possible" | "probable" | "definite";
  outcome: "resolved" | "resolving" | "not_resolved" | "resolved_with_sequelae" | "fatal" | "unknown";
  actionTaken: "none" | "session_paused" | "session_stopped" | "subject_withdrawn" | "medical_treatment_provided" | "other";
  followUpRequired?: boolean;
}

/**
 * Clinical-trial adverse event documentation (docs/phase4/safety-monitoring-plan.md,
 * ADR-011) - always clinician-authored, never derived from ML output. See
 * adverse-event-record.schema.json's own doc comment for why this is a
 * distinct record from the real-time SymptomReport.
 */
@Injectable()
export class AdverseEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateAdverseEventInput) {
    const reportedAt = new Date().toISOString();
    const record = {
      adverseEventRecordId: uuid(),
      sessionId: input.sessionId ?? null,
      subjectPseudoId: input.subjectPseudoId,
      reportedByClinicianId: input.reportedByClinicianId,
      relatedSymptomReportId: input.relatedSymptomReportId ?? null,
      onsetAt: input.onsetAt,
      reportedAt,
      description: input.description,
      severity: input.severity,
      serious: input.serious,
      causality: input.causality,
      outcome: input.outcome,
      actionTaken: input.actionTaken,
      followUpRequired: input.followUpRequired ?? false,
      reportedToEthicsBoardAt: null,
    };

    const validate = getValidator("adverse-event-record");
    if (!validate(record)) {
      throw new BadRequestException({ message: "Invalid adverse event record", errors: validate.errors });
    }

    await this.prisma.adverseEvent.create({
      data: {
        id: record.adverseEventRecordId,
        sessionId: record.sessionId,
        subjectPseudoId: record.subjectPseudoId,
        reportedByClinicianId: record.reportedByClinicianId,
        relatedSymptomReportId: record.relatedSymptomReportId,
        onsetAt: new Date(record.onsetAt),
        reportedAt: new Date(record.reportedAt),
        description: record.description,
        severity: record.severity,
        serious: record.serious,
        causality: record.causality,
        outcome: record.outcome,
        actionTaken: record.actionTaken,
        followUpRequired: record.followUpRequired,
      },
    });
    return record;
  }

  list(filters: { subjectPseudoId?: string; sessionId?: string; seriousOnly?: boolean } = {}) {
    return this.prisma.adverseEvent.findMany({
      where: {
        subjectPseudoId: filters.subjectPseudoId,
        sessionId: filters.sessionId,
        serious: filters.seriousOnly ? true : undefined,
      },
      orderBy: { reportedAt: "desc" },
    });
  }

  /**
   * Marks when a serious event was actually reported to the study's ethics
   * board. Records compliance with the reporting-timeline obligation
   * (docs/phase4/safety-monitoring-plan.md) - never enforces or computes a
   * deadline itself.
   */
  async recordEthicsBoardReport(id: string) {
    return this.prisma.adverseEvent.update({
      where: { id },
      data: { reportedToEthicsBoardAt: new Date() },
    });
  }
}
