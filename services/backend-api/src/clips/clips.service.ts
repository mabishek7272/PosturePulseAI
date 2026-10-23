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
import { clipDirFromEnv } from "./clip-dir";

export const MAX_CLIP_BYTES = 100 * 1024 * 1024;
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

interface Sidecar {
  clipId: string;
  sessionId: string;
  stepId: string;
  view: View;
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
    private readonly clipDir: string = clipDirFromEnv()
  ) {}

  /** Always consumes (deletes) the temporary upload file, whether or not the clip is accepted. */
  async accept(
    sessionId: string,
    stepId: string,
    file: UploadedClipFile,
    sidecarRaw: string | undefined
  ): Promise<{ clipId: string; status: string }> {
    let moved = false;
    try {
      const step = this.battery.step(stepId);
      if (!step) throw new NotFoundException(`Unknown step "${stepId}".`);

      assertUploadAllowed(await this.safety.getState(sessionId));

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

      const sha256 = await sha256OfFile(file.path);

      // A retried upload (the device may not have seen our 2xx) is answered from the stored row.
      const existing = await this.prisma.clip.findUnique({ where: { id: sidecar.clipId } });
      if (existing) {
        if (existing.sessionId === sessionId && existing.stepId === stepId && existing.sha256 === sha256) {
          return { clipId: existing.id, status: existing.status };
        }
        throw new ConflictException("This clipId is already in use.");
      }

      await mkdir(this.clipDir, { recursive: true });
      const finalPath = path.join(this.clipDir, `${sidecar.clipId}.mov`);
      await rename(file.path, finalPath);
      moved = true;
      try {
        const clip = await this.prisma.clip.create({
          data: {
            id: sidecar.clipId,
            sessionId,
            stepId,
            path: finalPath,
            sha256,
            sidecar: JSON.parse(sidecarRaw as string) as object,
            status: "uploaded",
            job: { create: {} },
          },
        });
        return { clipId: clip.id, status: clip.status };
      } catch (error) {
        await rm(finalPath, { force: true });
        throw error;
      }
    } finally {
      if (!moved) await rm(file.path, { force: true });
    }
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
