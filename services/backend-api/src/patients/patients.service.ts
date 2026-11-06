import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { PatientCrypto } from "./patient-crypto";

export const MAX_SEARCH_RESULTS = 200;
const MAX_FIELD_CHARS = 200;
const MAX_NOTE_CHARS = 500;

const SMOKING_VALUES = ["never", "former", "current"] as const;
const ALCOHOL_VALUES = ["never", "occasional", "regular"] as const;
const ACTIVITY_VALUES = ["sedentary", "light", "moderate", "active"] as const;

export type Smoking = (typeof SMOKING_VALUES)[number];
export type Alcohol = (typeof ALCOHOL_VALUES)[number];
export type PhysicalActivityLevel = (typeof ACTIVITY_VALUES)[number];

/**
 * Optional clinical intake, collected alongside identity at patient creation.
 * Every field is documentary context for the clinician reviewing a report -
 * nothing in the measurement or reference-comparison pipeline reads this.
 * Stratified reference ranges by any of these are a clinical-content
 * decision this repo does not make unilaterally (CLAUDE.md, docs/claims-and-scope.md).
 */
export interface PatientIntake {
  heightCm?: number;
  weightKg?: number;
  smoking?: Smoking;
  alcohol?: Alcohol;
  physicalActivityLevel?: PhysicalActivityLevel;
  physicalProblems?: string | null;
  recentAccident?: boolean;
  recentAccidentDetails?: string | null;
}

export interface NewPatient {
  name: string;
  dateOfBirth: string;
  contact?: string | null;
  intake?: PatientIntake | null;
}

export interface PatientRecord {
  id: string;
  name: string;
  dateOfBirth: string;
  contact: string | null;
  intake: PatientIntake | null;
  createdAt: Date;
}

export interface LinkedSession {
  id: string;
  state: string;
  createdAt: Date;
  deploymentContext: string;
  protocolId: string;
}

/**
 * The clinician-only patient register (ADR-017). Name, date of birth and
 * contact exist only as AES-256-GCM ciphertext in the Patient table. They are
 * never written to the event log, the session, a consent record or a report;
 * the only bridge to measurements is the pseudonymous subjectPseudoId in
 * PatientSubjectLink.
 *
 * The Patient table also holds self-signup rows (email/passwordHash,
 * ADR-019) - this service never operates on those; open() explicitly skips
 * any row without a register-style nameEnc/dobEnc.
 */
@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PatientCrypto
  ) {}

  async create(input: NewPatient, clinicianId: string): Promise<PatientRecord> {
    const name = this.requiredText(input?.name, "name");
    const dateOfBirth = this.dateOfBirth(input?.dateOfBirth);
    const contact = input?.contact === undefined || input?.contact === null ? null : this.requiredText(input.contact, "contact", true);
    const intake = this.intake(input?.intake);

    const row = await this.prisma.patient.create({
      data: {
        nameEnc: this.crypto.encrypt("name", name),
        dobEnc: this.crypto.encrypt("dob", dateOfBirth),
        contactEnc: contact === null || contact === "" ? null : this.crypto.encrypt("contact", contact),
        intakeEnc: intake ? this.crypto.encrypt("intake", JSON.stringify(intake)) : null,
        createdBy: clinicianId,
      },
    });
    return { id: row.id, name, dateOfBirth, contact: contact || null, intake, createdAt: row.createdAt };
  }

  /**
   * Fields are ciphertext, so the database cannot filter them: every row is
   * decrypted and matched here. Fine for a clinic-sized register; revisit
   * (blind index) before the register grows large.
   */
  async search(q?: string): Promise<PatientRecord[]> {
    const needle = (q ?? "").trim().toLowerCase();
    const rows = await this.prisma.patient.findMany({ orderBy: { createdAt: "asc" } });
    const matches: PatientRecord[] = [];
    for (const row of rows) {
      const record = this.open(row);
      if (!record) continue;
      if (needle && !record.name.toLowerCase().includes(needle) && !(record.contact ?? "").toLowerCase().includes(needle)) continue;
      matches.push(record);
    }
    matches.sort((a, b) => a.name.localeCompare(b.name));
    return matches.slice(0, MAX_SEARCH_RESULTS);
  }

  /** One patient's record, decrypted for this response only (ADR-017). 404 when unknown or not yet clinician-registered. */
  async get(patientId: string): Promise<PatientRecord> {
    const row = await this.prisma.patient.findUnique({ where: { id: patientId } });
    const record = row ? this.open(row) : null;
    if (!record) throw new NotFoundException(`Patient ${patientId} not found.`);
    return record;
  }

  async link(patientId: string, subjectPseudoId: string): Promise<{ patientId: string; subjectPseudoId: string }> {
    if (typeof subjectPseudoId !== "string" || !subjectPseudoId.trim()) {
      throw new BadRequestException("subjectPseudoId is required.");
    }
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw new NotFoundException(`Patient ${patientId} not found.`);
    const session = await this.prisma.session.findFirst({ where: { subjectPseudoId } });
    if (!session) throw new NotFoundException("No session exists for that subjectPseudoId.");

    const existing = await this.prisma.patientSubjectLink.findUnique({ where: { subjectPseudoId } });
    if (existing) {
      if (existing.patientId === patientId) return { patientId, subjectPseudoId };
      throw new ConflictException("That subjectPseudoId is already linked to another patient.");
    }
    await this.prisma.patientSubjectLink.create({ data: { patientId, subjectPseudoId } });
    return { patientId, subjectPseudoId };
  }

  async sessions(patientId: string): Promise<LinkedSession[]> {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw new NotFoundException(`Patient ${patientId} not found.`);
    const links = await this.prisma.patientSubjectLink.findMany({ where: { patientId } });
    if (links.length === 0) return [];
    const sessions = await this.prisma.session.findMany({
      where: { subjectPseudoId: { in: links.map((l: { subjectPseudoId: string }) => l.subjectPseudoId) } },
      orderBy: { createdAt: "desc" },
    });
    return sessions.map((s: LinkedSession) => ({
      id: s.id,
      state: s.state,
      createdAt: s.createdAt,
      deploymentContext: s.deploymentContext,
      protocolId: s.protocolId,
    }));
  }

  private open(row: {
    id: string;
    nameEnc: string | null;
    dobEnc: string | null;
    contactEnc: string | null;
    intakeEnc: string | null;
    createdAt: Date;
  }): PatientRecord | null {
    // A self-signup patient (Part 1 of the accounts redesign) has no
    // clinician-entered name/DOB yet - it isn't a clinician-register entry,
    // so it's correctly excluded from search results, not an error.
    if (row.nameEnc === null || row.dobEnc === null) return null;
    try {
      return {
        id: row.id,
        name: this.crypto.decrypt("name", row.nameEnc),
        dateOfBirth: this.crypto.decrypt("dob", row.dobEnc),
        contact: row.contactEnc ? this.crypto.decrypt("contact", row.contactEnc) : null,
        intake: row.intakeEnc ? (JSON.parse(this.crypto.decrypt("intake", row.intakeEnc)) as PatientIntake) : null,
        createdAt: row.createdAt,
      };
    } catch {
      // A row sealed under a different key, or a pre-migration row with no
      // intakeEnc column read before `prisma generate` picked it up, must not
      // take the whole register down.
      return null;
    }
  }

  /**
   * Every field is optional; only the ones a clinician actually knows get
   * sent. Bounds here are sanity limits against garbage input (a mistyped
   * 2500cm height), not a clinical judgement of what is plausible for a
   * given patient.
   */
  private intake(value: PatientIntake | null | undefined): PatientIntake | null {
    if (value === null || value === undefined) return null;
    const out: PatientIntake = {};

    if (value.heightCm !== undefined) {
      out.heightCm = this.boundedNumber(value.heightCm, "intake.heightCm", 30, 272);
    }
    if (value.weightKg !== undefined) {
      out.weightKg = this.boundedNumber(value.weightKg, "intake.weightKg", 1, 500);
    }
    if (value.smoking !== undefined) out.smoking = this.enumValue(value.smoking, "intake.smoking", SMOKING_VALUES);
    if (value.alcohol !== undefined) out.alcohol = this.enumValue(value.alcohol, "intake.alcohol", ALCOHOL_VALUES);
    if (value.physicalActivityLevel !== undefined) {
      out.physicalActivityLevel = this.enumValue(value.physicalActivityLevel, "intake.physicalActivityLevel", ACTIVITY_VALUES);
    }
    if (value.physicalProblems !== undefined && value.physicalProblems !== null) {
      out.physicalProblems = this.freeTextNote(value.physicalProblems, "intake.physicalProblems");
    }
    if (value.recentAccident !== undefined) {
      if (typeof value.recentAccident !== "boolean") throw new BadRequestException("intake.recentAccident must be a boolean.");
      out.recentAccident = value.recentAccident;
    }
    if (value.recentAccidentDetails !== undefined && value.recentAccidentDetails !== null) {
      out.recentAccidentDetails = this.freeTextNote(value.recentAccidentDetails, "intake.recentAccidentDetails");
    }

    return Object.keys(out).length > 0 ? out : null;
  }

  /**
   * A clinical free-text note, not an identity field - truncated to
   * MAX_NOTE_CHARS rather than rejected, since a clinician who typed a long
   * note should not lose the whole patient record over it. Deliberately not
   * routed through requiredText(), whose MAX_FIELD_CHARS (200) is sized for
   * a name or a phone number and would throw before truncation ran.
   */
  private freeTextNote(value: unknown, field: string): string | null {
    if (typeof value !== "string") throw new BadRequestException(`${field} must be a string.`);
    const trimmed = value.trim().slice(0, MAX_NOTE_CHARS);
    return trimmed || null;
  }

  private boundedNumber(value: unknown, field: string, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new BadRequestException(`${field} must be a number.`);
    if (value < min || value > max) throw new BadRequestException(`${field} must be between ${min} and ${max}.`);
    return value;
  }

  private enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
    if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
      throw new BadRequestException(`${field} must be one of: ${allowed.join(", ")}.`);
    }
    return value as T;
  }

  private requiredText(value: unknown, field: string, allowEmpty = false): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} must be a string.`);
    const trimmed = value.trim();
    if (!allowEmpty && !trimmed) throw new BadRequestException(`${field} is required.`);
    if (trimmed.length > MAX_FIELD_CHARS) throw new BadRequestException(`${field} is longer than ${MAX_FIELD_CHARS} characters.`);
    return trimmed;
  }

  private dateOfBirth(value: unknown): string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException("dateOfBirth must be an ISO date (YYYY-MM-DD).");
    }
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException("dateOfBirth is not a real calendar date.");
    }
    if (parsed.getTime() > Date.now()) throw new BadRequestException("dateOfBirth cannot be in the future.");
    return value;
  }
}
