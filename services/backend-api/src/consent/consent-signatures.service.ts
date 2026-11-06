import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { getValidator } from "../common/schema-registry";
import { PatientCrypto } from "../patients/patient-crypto";

export interface SignaturesInput {
  subjectSvgPath: string;
  clinicianSvgPath: string;
}

export interface ConsentSignatures {
  subject: { svgPath: string; signedAt: string };
  clinician: { svgPath: string; signedAt: string; clinicianId: string };
}

/**
 * Patient and clinician signatures on a consent record, captured on the clinic
 * device before the first recording.
 *
 * - Sealed with the patient-register key (AES-256-GCM, field-bound), because a
 *   handwritten signature identifies a person as much as a name does (ADR-017).
 * - The clinician id comes from the caller's token, never from the body.
 * - Write-once: a consent record is signed one time; a second attempt is 409,
 *   so a signature can never be silently replaced.
 * - The server stamps `signedAt` (time of receipt) rather than trusting the
 *   device clock.
 */
@Injectable()
export class ConsentSignaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PatientCrypto
  ) {}

  async attach(consentRecordId: string, input: SignaturesInput, clinicianId: string): Promise<{ consentRecordId: string; signedAt: string }> {
    const record = await this.prisma.consentRecord.findUnique({ where: { id: consentRecordId } });
    if (!record) throw new NotFoundException(`Consent record ${consentRecordId} not found.`);
    if (record.revokedAt) throw new ConflictException("This consent record has been revoked.");
    if (record.signaturesEnc) throw new ConflictException("This consent record is already signed.");

    const signedAt = new Date().toISOString();
    const signatures: ConsentSignatures = {
      subject: { svgPath: String(input?.subjectSvgPath ?? ""), signedAt },
      clinician: { svgPath: String(input?.clinicianSvgPath ?? ""), signedAt, clinicianId },
    };
    // Validated as part of the whole record, so the schema is the one contract.
    const candidate = {
      consentRecordId: record.id,
      subjectPseudoId: record.subjectPseudoId,
      scopes: record.scopes,
      grantedAt: record.grantedAt.toISOString(),
      revokedAt: null,
      withdrawalRequestedAt: null,
      signatures,
    };
    const validate = getValidator("consent-record");
    if (!validate(candidate)) {
      throw new BadRequestException({ message: "Invalid signatures", errors: validate.errors });
    }

    // Conditional update: two devices racing to sign the same record cannot both win.
    const { count } = await this.prisma.consentRecord.updateMany({
      where: { id: consentRecordId, signaturesEnc: null },
      data: { signaturesEnc: this.crypto.encrypt("consent_signatures", JSON.stringify(signatures)) },
    });
    if (count === 0) throw new ConflictException("This consent record is already signed.");
    return { consentRecordId, signedAt };
  }

  /** Decrypted signatures, or 404 when the record does not exist or was never signed. */
  async get(consentRecordId: string): Promise<ConsentSignatures> {
    const record = await this.prisma.consentRecord.findUnique({ where: { id: consentRecordId } });
    if (!record?.signaturesEnc) throw new NotFoundException("No signatures on this consent record.");
    return JSON.parse(this.crypto.decrypt("consent_signatures", record.signaturesEnc)) as ConsentSignatures;
  }
}
