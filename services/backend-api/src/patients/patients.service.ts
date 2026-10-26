import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { PatientCrypto } from "./patient-crypto";

export const MAX_SEARCH_RESULTS = 200;
const MAX_FIELD_CHARS = 200;

export interface NewPatient {
  name: string;
  dateOfBirth: string;
  contact?: string | null;
}

export interface PatientRecord {
  id: string;
  name: string;
  dateOfBirth: string;
  contact: string | null;
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

    const row = await this.prisma.patient.create({
      data: {
        nameEnc: this.crypto.encrypt("name", name),
        dobEnc: this.crypto.encrypt("dob", dateOfBirth),
        contactEnc: contact === null || contact === "" ? null : this.crypto.encrypt("contact", contact),
        createdBy: clinicianId,
      },
    });
    return { id: row.id, name, dateOfBirth, contact: contact || null, createdAt: row.createdAt };
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

  private open(row: { id: string; nameEnc: string | null; dobEnc: string | null; contactEnc: string | null; createdAt: Date }): PatientRecord | null {
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
        createdAt: row.createdAt,
      };
    } catch {
      // A row sealed under a different key must not take the whole register down.
      return null;
    }
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
