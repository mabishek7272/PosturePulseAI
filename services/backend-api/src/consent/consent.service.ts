import { BadRequestException, Injectable } from "@nestjs/common";
import { v4 as uuid } from "uuid";
import { PrismaService } from "../common/prisma.service";
import { getValidator } from "../common/schema-registry";

export interface CreateConsentRecordInput {
  subjectPseudoId: string;
  scopes: string[];
}

@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateConsentRecordInput) {
    const id = uuid();
    const record = {
      consentRecordId: id,
      subjectPseudoId: input.subjectPseudoId,
      scopes: input.scopes,
      grantedAt: new Date().toISOString(),
      revokedAt: null,
      withdrawalRequestedAt: null,
    };

    const validate = getValidator("consent-record");
    if (!validate(record)) {
      throw new BadRequestException({ message: "Invalid consent scopes", errors: validate.errors });
    }

    await this.prisma.consentRecord.create({
      data: { id, subjectPseudoId: input.subjectPseudoId, scopes: input.scopes },
    });
    return this.get(id);
  }

  async get(id: string) {
    return this.prisma.consentRecord.findUniqueOrThrow({ where: { id } });
  }

  /** True only when a non-revoked consent record exists for `consentRecordId` with `scope` in its scopes. */
  async hasActiveScope(consentRecordId: string, scope: string): Promise<boolean> {
    const record = await this.prisma.consentRecord.findUnique({ where: { id: consentRecordId } });
    if (!record || record.revokedAt) return false;
    const scopes = record.scopes as unknown as string[];
    return scopes.includes(scope);
  }
}
