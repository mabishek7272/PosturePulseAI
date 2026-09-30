import { ForbiddenException, Injectable } from "@nestjs/common";
import { v4 as uuid } from "uuid";
import { SubjectAuthService } from "../auth/subject-auth.service";
import { ConsentService } from "../consent/consent.service";
import { EventsService } from "../events/events.service";
import { PrismaService } from "../common/prisma.service";
import { SafetyService } from "../safety/safety.service";

export interface CreateSessionInput {
  subjectPseudoId: string;
  protocolId: string;
  protocolVersion: string;
  deploymentContext: "clinic_supervised" | "home_rehab";
  consentRecordId: string;
  retentionPolicy: unknown;
  calibrationRef?: string | null;
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyService,
    private readonly events: EventsService,
    private readonly consent: ConsentService,
    private readonly subjectAuth: SubjectAuthService
  ) {}

  async create(input: CreateSessionInput) {
    await this.assertConsentCovers(input);
    const id = uuid();
    await this.prisma.session.create({
      data: {
        id,
        subjectPseudoId: input.subjectPseudoId,
        protocolId: input.protocolId,
        protocolVersion: input.protocolVersion,
        deploymentContext: input.deploymentContext,
        consentRecordId: input.consentRecordId,
        retentionPolicy: input.retentionPolicy as object,
        calibrationRef: input.calibrationRef ?? null,
        state: "Setup",
      },
    });
    // Seeds the actor + persisted snapshot for this session id.
    await this.safety.startSession(id);
    const session = await this.get(id);
    const sessionToken = await this.subjectAuth.issueSessionToken(id, input.subjectPseudoId);
    return { session, sessionToken };
  }

  private async assertConsentCovers(input: CreateSessionInput) {
    const consent = await this.consent.findActive(input.consentRecordId);
    if (!consent || consent.subjectPseudoId !== input.subjectPseudoId) {
      throw new ForbiddenException("No active consent record for this subject.");
    }
    if (!consent.scopes.includes("derived_events")) {
      throw new ForbiddenException("Consent record lacks the 'derived_events' scope required to run a session.");
    }
    const rawVideo = (input.retentionPolicy as { rawVideo?: { optIn?: boolean } } | null)?.rawVideo;
    if (rawVideo?.optIn === true && !consent.scopes.includes("raw_video")) {
      throw new ForbiddenException("Raw video retention requires the 'raw_video' consent scope.");
    }
  }

  async get(id: string) {
    return this.prisma.session.findUniqueOrThrow({ where: { id } });
  }

  /**
   * The clinician dashboard's review queue (apps/clinician-web). Optionally
   * filtered to a single safety-FSM `state` (e.g. `Pause`/`ClinicianReview`)
   * so a clinician can find sessions that actually need attention without
   * scanning every session. Ordered most-recent-first; capped at `limit` -
   * this is a review queue, not a full audit export.
   */
  async list(options: { state?: string; limit?: number } = {}) {
    return this.prisma.session.findMany({
      where: options.state ? { state: options.state } : undefined,
      orderBy: { createdAt: "desc" },
      take: options.limit ?? 100,
    });
  }

  async setHeight(id: string, subjectHeightMeters: number) {
    await this.prisma.session.update({ where: { id }, data: { subjectHeightMeters } });
    return this.get(id);
  }

  /** Persists a ml-service-computed ScaleCalibrationRecord and updates the
   * session's denormalized calibrationRef so future frame submissions resolve
   * scaleValidated correctly (see ml-integration/frames.controller.ts). */
  async recordScaleCalibration(id: string, record: { scaleCalibrationId: string }) {
    await this.events.appendValidated(id, "scale-calibration-record", record);
    await this.prisma.session.update({ where: { id }, data: { calibrationRef: record.scaleCalibrationId } });
    return this.get(id);
  }
}
