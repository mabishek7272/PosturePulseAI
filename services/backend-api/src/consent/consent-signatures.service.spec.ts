import "reflect-metadata";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from "@nestjs/common/constants";
import { randomBytes } from "node:crypto";
import { AUDIT_ACTION_KEY } from "../audit/audit-action.decorator";
import { AuditLogInterceptor } from "../audit/audit-log.interceptor";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ROLES_KEY } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { PatientCrypto } from "../patients/patient-crypto";
import { ConsentSignaturesService } from "./consent-signatures.service";
import { ConsentController } from "./consent.controller";
import { ConsentService, PUBLIC_FIELDS } from "./consent.service";

const PATH = "M10 10Q12.5 11 15 12L20.2 14.8";

function setup(row: Record<string, unknown> | null = { id: "c1", subjectPseudoId: "s1", scopes: ["derived_events"], grantedAt: new Date("2026-11-06T10:00:00Z"), revokedAt: null, signaturesEnc: null }) {
  const store = row ? { ...row } : null;
  const prisma = {
    consentRecord: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(store ? { ...store } : null)),
      updateMany: jest.fn().mockImplementation(({ where, data }) => {
        if (!store || store.signaturesEnc !== where.signaturesEnc) return Promise.resolve({ count: 0 });
        Object.assign(store, data);
        return Promise.resolve({ count: 1 });
      }),
    },
  };
  const crypto = new PatientCrypto(randomBytes(32).toString("base64"));
  return { service: new ConsentSignaturesService(prisma as never, crypto), store, prisma };
}

describe("ConsentSignaturesService", () => {
  it("seals both signatures, takes the clinician from the caller, and round-trips them", async () => {
    const { service, store } = setup();
    const out = await service.attach("c1", { subjectSvgPath: PATH, clinicianSvgPath: PATH }, "clin-7");
    expect(out.consentRecordId).toBe("c1");
    expect(String(store!.signaturesEnc)).toMatch(/^v1\./);
    expect(String(store!.signaturesEnc)).not.toContain(PATH);
    const back = await service.get("c1");
    expect(back.subject.svgPath).toBe(PATH);
    expect(back.clinician).toMatchObject({ svgPath: PATH, clinicianId: "clin-7" });
  });

  it("is write-once", async () => {
    const { service } = setup();
    await service.attach("c1", { subjectSvgPath: PATH, clinicianSvgPath: PATH }, "clin-7");
    await expect(service.attach("c1", { subjectSvgPath: PATH, clinicianSvgPath: PATH }, "clin-8")).rejects.toThrow(ConflictException);
  });

  it("refuses a revoked record and an unknown one", async () => {
    const revoked = setup({ id: "c1", subjectPseudoId: "s1", scopes: ["derived_events"], grantedAt: new Date(), revokedAt: new Date(), signaturesEnc: null });
    await expect(revoked.service.attach("c1", { subjectSvgPath: PATH, clinicianSvgPath: PATH }, "c")).rejects.toThrow(ConflictException);
    await expect(setup(null).service.attach("x", { subjectSvgPath: PATH, clinicianSvgPath: PATH }, "c")).rejects.toThrow(NotFoundException);
  });

  it("rejects an empty signature and anything that is not plain path data", async () => {
    const { service } = setup();
    await expect(service.attach("c1", { subjectSvgPath: "", clinicianSvgPath: PATH }, "c")).rejects.toThrow(BadRequestException);
    await expect(service.attach("c1", { subjectSvgPath: PATH, clinicianSvgPath: '"/><script>x</script>' }, "c")).rejects.toThrow(BadRequestException);
  });

  it("404s when there is nothing to read", async () => {
    await expect(setup().service.get("c1")).rejects.toThrow(NotFoundException);
  });
});

describe("consent signature routes", () => {
  it.each([
    ["sign", "sign_consent"],
    ["getSignatures", "view_consent_signatures"],
  ])("%s is clinician-only and audited as %s", (method, action) => {
    const handler = (ConsentController.prototype as unknown as Record<string, object>)[method]!;
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(["clinician"]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, handler)).toEqual([AuditLogInterceptor]);
    expect(Reflect.getMetadata(AUDIT_ACTION_KEY, handler)).toBe(action);
  });

  it("passes the token's clinician, not anything from the body", async () => {
    const signatures = { attach: jest.fn().mockResolvedValue({}) };
    const controller = new ConsentController({} as never, signatures as never);
    await controller.sign("c1", { subjectSvgPath: PATH, clinicianSvgPath: PATH, clinicianId: "spoof" } as never, { user: { sub: "clin-real" } });
    expect(signatures.attach).toHaveBeenCalledWith("c1", expect.anything(), "clin-real");
  });
});

describe("unauthenticated consent reads", () => {
  it("never select the sealed signatures", async () => {
    expect(PUBLIC_FIELDS).not.toHaveProperty("signaturesEnc");
    const prisma = { consentRecord: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "c1" }) } };
    await new ConsentService(prisma as never).get("c1");
    expect(prisma.consentRecord.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "c1" }, select: PUBLIC_FIELDS });
  });
});
