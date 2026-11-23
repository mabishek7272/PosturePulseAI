import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { PatientCrypto } from "../patients/patient-crypto";

const MAX_TEXT = 200;
const MAX_SIGNATURE_PATHS = 40;
const MAX_SIGNATURE_PATH_CHARS = 8000;
const MAX_SIGNATURE_TOTAL_CHARS = 40000;
const MAX_SIGNATURE_DIMENSION = 2000;
/** Moves and lines only: a signature is polylines, never script, a font or an image reference. */
const PATH_PATTERN = /^[ML0-9.\- ]+$/;

/** A drawn signature as vector strokes (SVG path data), so it renders in any report without an image pipeline. */
export interface Signature {
  width: number;
  height: number;
  paths: string[];
}

export interface ClinicianProfileInput {
  fullName?: string;
  specialty?: string;
  licenceNumber?: string;
  qualifications?: string | null;
  licensingAuthority?: string | null;
  clinic?: string | null;
  professionalContact?: string | null;
  signature?: Signature;
}

/** What the API reports. The drawing itself is never returned here: only whether one is on file. */
export interface ClinicianProfile {
  fullName: string | null;
  specialty: string | null;
  licenceNumber: string | null;
  qualifications: string | null;
  licensingAuthority: string | null;
  clinic: string | null;
  professionalContact: string | null;
  hasSignature: boolean;
  /** Everything the sign-off needs: name, specialty, licence number and a signature. */
  complete: boolean;
  updatedAt: string | null;
}

/** Frozen into a released report, so a later edit of the profile cannot rewrite who signed it. */
export interface SignerSnapshot {
  clinicianId: string;
  username: string;
  fullName: string;
  specialty: string;
  licenceNumber: string;
  qualifications?: string;
  licensingAuthority?: string;
  clinic?: string;
  signature: Signature;
  signatureSha256: string;
}

/** The registering clinician, stamped on a patient record server-side (never taken from the client). */
export interface RegistrarSnapshot {
  clinicianId: string;
  fullName: string;
  licenceNumber: string;
  signatureSha256: string;
  registeredAt: string;
}

export function signatureSha256(signature: Signature): string {
  return createHash("sha256").update(JSON.stringify({ width: signature.width, height: signature.height, paths: signature.paths })).digest("hex");
}

@Injectable()
export class ClinicianProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PatientCrypto
  ) {}

  async get(clinicianId: string): Promise<ClinicianProfile> {
    return this.toProfile(await this.load(clinicianId));
  }

  async update(clinicianId: string, input: ClinicianProfileInput): Promise<ClinicianProfile> {
    const row = await this.load(clinicianId);
    const data: Record<string, unknown> = { profileUpdatedAt: new Date() };

    if (input?.fullName !== undefined) data.fullName = this.required(input.fullName, "fullName");
    if (input?.specialty !== undefined) data.specialty = this.required(input.specialty, "specialty");
    if (input?.licenceNumber !== undefined) data.licenceNumber = this.required(input.licenceNumber, "licenceNumber");
    for (const field of ["qualifications", "licensingAuthority", "clinic", "professionalContact"] as const) {
      if (input?.[field] !== undefined) data[field] = this.optional(input[field], field);
    }
    if (input?.signature !== undefined) {
      data.signatureEnc = this.crypto.encrypt("clinician_signature", JSON.stringify(this.validSignature(input.signature)));
    }

    const updated = await this.prisma.clinician.update({ where: { id: row.id }, data });
    return this.toProfile(updated);
  }

  /**
   * The frozen record of who signs. Refuses (409) when the profile is incomplete,
   * so a report is never released under a name with no licence or signature.
   */
  async signerSnapshot(clinicianId: string): Promise<SignerSnapshot> {
    const row = await this.load(clinicianId);
    const signature = this.openSignature(row.signatureEnc);
    if (!row.fullName || !row.specialty || !row.licenceNumber || !signature) {
      throw new ConflictException("Complete your doctor profile (name, specialty, licence number and signature) first.");
    }
    return {
      clinicianId: row.id,
      username: row.username,
      fullName: row.fullName,
      specialty: row.specialty,
      licenceNumber: row.licenceNumber,
      ...(row.qualifications ? { qualifications: row.qualifications } : {}),
      ...(row.licensingAuthority ? { licensingAuthority: row.licensingAuthority } : {}),
      ...(row.clinic ? { clinic: row.clinic } : {}),
      signature,
      signatureSha256: signatureSha256(signature),
    };
  }

  async registrarSnapshot(clinicianId: string): Promise<RegistrarSnapshot> {
    const snapshot = await this.signerSnapshot(clinicianId);
    return {
      clinicianId: snapshot.clinicianId,
      fullName: snapshot.fullName,
      licenceNumber: snapshot.licenceNumber,
      signatureSha256: snapshot.signatureSha256,
      registeredAt: new Date().toISOString(),
    };
  }

  private async load(clinicianId: string) {
    const row = await this.prisma.clinician.findUnique({ where: { id: clinicianId } });
    if (!row) throw new NotFoundException("Clinician not found.");
    return row;
  }

  private toProfile(row: Awaited<ReturnType<ClinicianProfileService["load"]>>): ClinicianProfile {
    const hasSignature = Boolean(row.signatureEnc);
    return {
      fullName: row.fullName,
      specialty: row.specialty,
      licenceNumber: row.licenceNumber,
      qualifications: row.qualifications,
      licensingAuthority: row.licensingAuthority,
      clinic: row.clinic,
      professionalContact: row.professionalContact,
      hasSignature,
      complete: Boolean(row.fullName && row.specialty && row.licenceNumber && hasSignature),
      updatedAt: row.profileUpdatedAt ? row.profileUpdatedAt.toISOString() : null,
    };
  }

  private openSignature(sealed: string | null): Signature | null {
    if (!sealed) return null;
    try {
      return JSON.parse(this.crypto.decrypt("clinician_signature", sealed)) as Signature;
    } catch {
      return null;
    }
  }

  private required(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} must be a string.`);
    const trimmed = value.trim();
    if (!trimmed) throw new BadRequestException(`${field} is required.`);
    if (trimmed.length > MAX_TEXT) throw new BadRequestException(`${field} is longer than ${MAX_TEXT} characters.`);
    return trimmed;
  }

  private optional(value: unknown, field: string): string | null {
    if (value === null) return null;
    if (typeof value !== "string") throw new BadRequestException(`${field} must be a string.`);
    const trimmed = value.trim();
    if (trimmed.length > MAX_TEXT) throw new BadRequestException(`${field} is longer than ${MAX_TEXT} characters.`);
    return trimmed || null;
  }

  private validSignature(value: unknown): Signature {
    const sig = value as Partial<Signature> | null;
    const dim = (n: unknown, name: string): number => {
      if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > MAX_SIGNATURE_DIMENSION) {
        throw new BadRequestException(`signature.${name} must be a number between 1 and ${MAX_SIGNATURE_DIMENSION}.`);
      }
      return n;
    };
    if (!sig || typeof sig !== "object") throw new BadRequestException("signature must be an object.");
    const width = dim(sig.width, "width");
    const height = dim(sig.height, "height");
    if (!Array.isArray(sig.paths) || sig.paths.length === 0) throw new BadRequestException("The signature is empty; draw it before saving.");
    if (sig.paths.length > MAX_SIGNATURE_PATHS) throw new BadRequestException(`signature has more than ${MAX_SIGNATURE_PATHS} strokes.`);
    let total = 0;
    for (const path of sig.paths) {
      if (typeof path !== "string" || !path.trim() || path.length > MAX_SIGNATURE_PATH_CHARS || !PATH_PATTERN.test(path)) {
        throw new BadRequestException("signature strokes must be SVG move/line path data.");
      }
      total += path.length;
    }
    if (total > MAX_SIGNATURE_TOTAL_CHARS) throw new BadRequestException("signature is too large.");
    return { width, height, paths: sig.paths.map((p) => p.trim()) };
  }
}
