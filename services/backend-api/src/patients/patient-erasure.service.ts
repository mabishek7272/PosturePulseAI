import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { rm } from "node:fs/promises";
import path from "node:path";
import { clipDirFromEnv } from "../clips/clip-dir";
import { PrismaService } from "../common/prisma.service";
import { PatientCrypto } from "./patient-crypto";

export interface ErasureResult {
  patientId: string;
  sessions: number;
  clips: number;
  reports: number;
  events: number;
  filesRemoved: number;
}

/**
 * Permanent erasure of one patient and everything recorded under their
 * pseudonymous visit codes: register entry, links, sessions, events, clips
 * (database rows AND the video, depth track and landmark series on disk),
 * analysis jobs, reports and consent records (with their signatures).
 *
 * Guardrails:
 * - The caller must type the patient's exact name. A stray tap or a replayed
 *   request cannot erase anyone.
 * - A patient with an adverse-event record is refused (409). Those are
 *   regulatory documentation, append-only by design (ADR-011): erasing the
 *   person would orphan them. Resolve that outside this route.
 * - Everything in the database goes in ONE transaction, so a failure leaves the
 *   patient intact. Files are removed only after it commits (best effort,
 *   logged); a file that cannot be removed is reported, never silently kept.
 * - The audit log is kept. It holds action names and ids only, no identifying
 *   fields, so it can say that an erasure happened without saying who it was.
 */
@Injectable()
export class PatientErasureService {
  private readonly logger = new Logger(PatientErasureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PatientCrypto,
    private readonly clipDir: string = clipDirFromEnv()
  ) {}

  async erase(patientId: string, confirmName: unknown): Promise<ErasureResult> {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient || patient.nameEnc === null) throw new NotFoundException(`Patient ${patientId} not found.`);

    const name = this.crypto.decrypt("name", patient.nameEnc);
    if (typeof confirmName !== "string" || confirmName.trim().toLowerCase() !== name.trim().toLowerCase()) {
      throw new BadRequestException("Type the patient's full name exactly to confirm erasure.");
    }

    const links = await this.prisma.patientSubjectLink.findMany({ where: { patientId } });
    const subjects = links.map((l: { subjectPseudoId: string }) => l.subjectPseudoId);
    const sessions = subjects.length
      ? await this.prisma.session.findMany({ where: { subjectPseudoId: { in: subjects } }, select: { id: true } })
      : [];
    const sessionIds = sessions.map((s: { id: string }) => s.id);

    const adverse = await this.prisma.adverseEvent.count({
      where: { OR: [{ subjectPseudoId: { in: subjects } }, { sessionId: { in: sessionIds } }] },
    });
    if (adverse > 0) {
      throw new ConflictException(
        "This patient has adverse-event records, which are kept as regulatory documentation. They cannot be erased here."
      );
    }

    const clips = sessionIds.length
      ? await this.prisma.clip.findMany({ where: { sessionId: { in: sessionIds } }, select: { id: true, path: true, depthPath: true } })
      : [];
    const clipIds = clips.map((c: { id: string }) => c.id);

    const counts = await this.prisma.$transaction(async (tx: any) => {
      await tx.analysisJob.deleteMany({ where: { clipId: { in: clipIds } } });
      await tx.clip.deleteMany({ where: { sessionId: { in: sessionIds } } });
      const events = await tx.event.deleteMany({ where: { sessionId: { in: sessionIds } } });
      const reports = await tx.assessmentReport.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await tx.session.deleteMany({ where: { id: { in: sessionIds } } });
      await tx.consentRecord.deleteMany({ where: { subjectPseudoId: { in: subjects } } });
      await tx.patientSubjectLink.deleteMany({ where: { patientId } });
      await tx.patient.delete({ where: { id: patientId } });
      return { events: events.count as number, reports: reports.count as number };
    });

    const filesRemoved = await this.removeFiles(clips);
    return { patientId, sessions: sessionIds.length, clips: clips.length, reports: counts.reports, events: counts.events, filesRemoved };
  }

  /** Video, depth track and the landmark series directory for every clip. Failures are logged and counted out. */
  private async removeFiles(clips: { id: string; path: string; depthPath: string | null }[]): Promise<number> {
    let removed = 0;
    for (const clip of clips) {
      const targets = [clip.path, clip.depthPath, path.join(this.clipDir, "landmarks", clip.id)].filter((t): t is string => !!t);
      for (const target of targets) {
        try {
          await rm(target, { recursive: true, force: true });
          removed += 1;
        } catch (e) {
          this.logger.error(`could not delete ${target}: ${(e as Error).message}`);
        }
      }
    }
    return removed;
  }
}
