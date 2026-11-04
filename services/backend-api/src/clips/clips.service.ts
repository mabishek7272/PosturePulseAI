import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { BatteryService } from "../battery/battery.service";
import type { View } from "../battery/types";
import { PrismaService } from "../common/prisma.service";
import { getValidator } from "../common/schema-registry";
import { SafetyService } from "../safety/safety.service";
import { SpotterService } from "../spotter/spotter.service";
import { clipDirFromEnv } from "./clip-dir";

export const MAX_CLIP_BYTES = 100 * 1024 * 1024;
/**
 * The depth track (ADR-020) is uint16 millimetres, zlib per frame, 256x192 at
 * 15 Hz: about 10-15 MB for a 30 s clip. 64 MB leaves generous headroom for a
 * longer capture or a poorly-compressing scene while still refusing a file that
 * cannot plausibly be a depth track for one clip. multer's per-file fileSize
 * (MAX_CLIP_BYTES) is the outer bound; this is the one that carries the meaning.
 */
export const MAX_DEPTH_BYTES = 64 * 1024 * 1024;
export const ACCEPTED_CLIP_TYPES = ["video/mp4", "video/quicktime"];
/** Session states in which no new clip may be taken (symptom pause, setup failure, clinician review). */
export const UPLOAD_BLOCKED_STATES = ["Pause", "Unavailable", "ClinicianReview"];

// clipId becomes a file name, so it must not be able to leave CLIP_DIR.
const SAFE_CLIP_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The part of a multer file this service needs (multer disk storage). */
export interface UploadedClipFile {
  path: string;
  size: number;
  mimetype: string;
}

interface SidecarDepth {
  frameCount: number;
  sha256: string;
  frames: Array<{ index: number; t: number }>;
}

interface Sidecar {
  clipId: string;
  sessionId: string;
  stepId: string;
  view: View;
  /** Absent or null when the device captured no depth (ADR-020). Never synthesised. */
  depth?: SidecarDepth | null;
}

export function assertUploadAllowed(state: string): void {
  if (UPLOAD_BLOCKED_STATES.includes(state)) {
    throw new ConflictException(`Session is in ${state}; clips cannot be uploaded until a clinician resumes it.`);
  }
}

function sha256OfFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Accepts an assessment clip and its sidecar (ADR-013): validates the sidecar
 * against clip-capture.schema.json and the route, stores the file, and queues
 * one analysis job. This service only reads the safety state (for the 409);
 * it never sends safety events.
 */
@Injectable()
export class ClipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyService,
    private readonly battery: BatteryService,
    private readonly spotter: SpotterService,
    private readonly clipDir: string = clipDirFromEnv()
  ) {}

  /**
   * Always consumes (deletes) the temporary upload files - the clip and the
   * optional depth track - whether or not the clip is accepted.
   */
  async accept(
    sessionId: string,
    stepId: string,
    file: UploadedClipFile,
    sidecarRaw: string | undefined,
    depthFile?: UploadedClipFile
  ): Promise<{ clipId: string; status: string }> {
    let moved = false;
    let depthMoved = false;
    try {
      const step = this.battery.step(stepId);
      if (!step) throw new NotFoundException(`Unknown step "${stepId}".`);

      assertUploadAllowed(await this.safety.getState(sessionId));

      // HZ-09. The app will not offer the shutter for a requiresSpotter step
      // without an attestation, but an app is a client - it can be an old
      // build, a modified build, or simply wrong. Refusing here is what makes
      // the control structural rather than documented: bypassing the prompt
      // cannot get the capture into the record.
      if (step.requiresSpotter && !(await this.spotter.isConfirmed(sessionId, stepId))) {
        throw new ConflictException(
          `Step "${stepId}" requires a clinician to confirm they are within arm's reach before it can be recorded.`
        );
      }

      if (!ACCEPTED_CLIP_TYPES.includes(file.mimetype)) {
        throw new UnsupportedMediaTypeException("The clip must be video/mp4 or video/quicktime.");
      }
      const sidecar = this.parseSidecar(sidecarRaw);
      if (sidecar.sessionId !== sessionId) throw new BadRequestException("Sidecar sessionId does not match the route.");
      if (sidecar.stepId !== stepId) throw new BadRequestException("Sidecar stepId does not match the route.");
      if (sidecar.view !== step.view) {
        throw new BadRequestException(`Sidecar view "${sidecar.view}" does not match the step's view "${step.view}".`);
      }
      if (!SAFE_CLIP_ID.test(sidecar.clipId)) {
        throw new BadRequestException("Sidecar clipId must be 1-64 letters, digits, '-' or '_'.");
      }

      await this.checkDepthPart(sidecar, depthFile);

      const sha256 = await sha256OfFile(file.path);

      // A retried upload (the device may not have seen our 2xx) is answered from the stored row.
      const replay = await this.replayOrConflict(sessionId, stepId, sidecar.clipId, sha256);
      if (replay) return replay;

      await mkdir(this.clipDir, { recursive: true });
      const finalPath = path.join(this.clipDir, `${sidecar.clipId}.mov`);
      const depthFinalPath = depthFile ? path.join(this.clipDir, `${sidecar.clipId}.depth`) : null;
      // The row is created first and the file moved into place inside the same transaction. Two uploads of the
      // same new clipId therefore race on the unique key, and the loser never touches the winner's file; the job
      // only becomes visible to the runner at commit, after the file is in place.
      let renamed = false;
      let depthRenamed = false;
      try {
        const clip = await this.prisma.$transaction(async (tx) => {
          const created = await tx.clip.create({
            data: {
              id: sidecar.clipId,
              sessionId,
              stepId,
              path: finalPath,
              depthPath: depthFinalPath,
              sha256,
              sidecar: JSON.parse(sidecarRaw as string) as object,
              status: "uploaded",
              job: { create: {} },
            },
          });
          // The depth track moves first: a depthPath row with no file would make
          // the analyser fail a clip whose video is perfectly good, whereas a
          // stray .depth file with no row is only wasted bytes, cleaned up below.
          if (depthFile && depthFinalPath) {
            await rename(depthFile.path, depthFinalPath);
            depthRenamed = true;
          }
          await rename(file.path, finalPath);
          renamed = true;
          return created;
        });
        moved = true;
        depthMoved = true;
        return { clipId: clip.id, status: clip.status };
      } catch (error) {
        if (renamed) {
          await rm(finalPath, { force: true });
          moved = true; // the temporary file is gone (renamed away); nothing left to delete at file.path
        }
        if (depthRenamed && depthFinalPath) {
          await rm(depthFinalPath, { force: true });
          depthMoved = true;
        }
        if ((error as { code?: string }).code === "P2002") {
          // Lost a race on the same clipId: answer from the winner's row instead of a 500.
          const replay = await this.replayOrConflict(sessionId, stepId, sidecar.clipId, sha256);
          if (replay) return replay;
        }
        throw error;
      }
    } finally {
      if (!moved) await rm(file.path, { force: true });
      if (depthFile && !depthMoved) await rm(depthFile.path, { force: true });
    }
  }

  /**
   * The sidecar's `depth` block and the `depth` file part describe the same
   * thing, so one without the other is always an error rather than something to
   * paper over: a declared depth track that never arrived would otherwise make
   * the analyser read a missing file, and an undeclared one would be stored with
   * no encoding, scale or timing to interpret it by - a measurement with no
   * provenance (CLAUDE.md rules 3 and 4).
   */
  private async checkDepthPart(sidecar: Sidecar, depthFile: UploadedClipFile | undefined): Promise<void> {
    const declared = sidecar.depth ?? null;
    if (declared && !depthFile) {
      throw new BadRequestException("The sidecar declares a depth track but no 'depth' file part was uploaded.");
    }
    if (depthFile && !declared) {
      throw new BadRequestException("A 'depth' file part was uploaded but the sidecar has no 'depth' block to describe it.");
    }
    if (!declared || !depthFile) return;

    if (declared.frames.length !== declared.frameCount) {
      throw new BadRequestException(
        `Sidecar depth.frameCount is ${declared.frameCount} but depth.frames has ${declared.frames.length} entries.`
      );
    }
    if (depthFile.size > MAX_DEPTH_BYTES) {
      throw new BadRequestException(`The depth track is larger than ${MAX_DEPTH_BYTES} bytes.`);
    }
    // Hashed before anything reads it as geometry: a truncated or swapped track
    // would otherwise decode into plausible-looking millimetres.
    const actual = await sha256OfFile(depthFile.path);
    if (actual !== declared.sha256) {
      throw new BadRequestException("The uploaded depth track does not match the sha256 declared in the sidecar.");
    }
  }

  /** The stored clip's answer when the same clip (session, step, bytes) is uploaded again; 409 for any other use of the clipId; null when the clipId is free. */
  private async replayOrConflict(
    sessionId: string,
    stepId: string,
    clipId: string,
    sha256: string
  ): Promise<{ clipId: string; status: string } | null> {
    const existing = await this.prisma.clip.findUnique({ where: { id: clipId } });
    if (!existing) return null;
    if (existing.sessionId === sessionId && existing.stepId === stepId && existing.sha256 === sha256) {
      return { clipId: existing.id, status: existing.status };
    }
    throw new ConflictException("This clipId is already in use.");
  }

  private parseSidecar(raw: string | undefined): Sidecar {
    if (!raw) throw new BadRequestException("The multipart field 'sidecar' is required.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException("The sidecar is not valid JSON.");
    }
    const validate = getValidator("clip-capture");
    if (!validate(parsed)) {
      throw new BadRequestException({ message: "The sidecar does not conform to clip-capture.", errors: validate.errors });
    }
    return parsed as Sidecar;
  }
}
