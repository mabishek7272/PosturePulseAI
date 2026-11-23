import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PatientCrypto } from "../patients/patient-crypto";
import { ClinicianProfileService, signatureSha256 } from "./clinician-profile.service";

function setup(initial: Record<string, unknown> | null = {}) {
  const crypto = new PatientCrypto(randomBytes(32).toString("base64"));
  const row: Record<string, unknown> | null = initial === null ? null : {
    id: "c1", username: "drchen", fullName: null, specialty: null, licenceNumber: null, qualifications: null,
    licensingAuthority: null, clinic: null, professionalContact: null, signatureEnc: null, profileUpdatedAt: null, ...initial,
  };
  const prisma = {
    clinician: {
      findUnique: jest.fn(async () => row),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(row!, data)),
    },
  };
  return { service: new ClinicianProfileService(prisma as never, crypto), row, prisma, crypto };
}

const SIGNATURE = { width: 300, height: 120, paths: ["M 10 10 L 50 60 L 90.5 20", "M 20 80 L 120 82"] };
const FULL = { fullName: "Dr Mei Chen", specialty: "Physiotherapy", licenceNumber: "PT-12345", signature: SIGNATURE };

describe("ClinicianProfileService", () => {
  it("starts incomplete: nothing on file", async () => {
    const { service } = setup();
    expect(await service.get("c1")).toMatchObject({ complete: false, hasSignature: false, fullName: null, licenceNumber: null });
  });

  it("is complete once name, specialty, licence and signature are all on file", async () => {
    const { service } = setup();
    const profile = await service.update("c1", FULL);
    expect(profile).toMatchObject({ fullName: "Dr Mei Chen", specialty: "Physiotherapy", licenceNumber: "PT-12345", hasSignature: true, complete: true });
    expect(profile.updatedAt).toEqual(expect.any(String));
  });

  it.each(["fullName", "specialty", "licenceNumber", "signature"] as const)("is not complete without %s", async (field) => {
    const { service } = setup();
    const { [field]: _omitted, ...rest } = FULL;
    expect((await service.update("c1", rest)).complete).toBe(false);
  });

  it("never returns the drawing, only whether one is on file", async () => {
    const { service } = setup();
    const profile = await service.update("c1", FULL);
    expect(JSON.stringify(profile)).not.toContain("M 10 10");
    expect(Object.keys(profile)).not.toContain("signature");
  });

  it("stores the signature as ciphertext", async () => {
    const { service, row, crypto } = setup();
    await service.update("c1", FULL);
    expect(JSON.stringify(row)).not.toContain("M 10 10");
    expect(JSON.parse(crypto.decrypt("clinician_signature", row!.signatureEnc as string)).paths).toEqual(SIGNATURE.paths);
  });

  it("keeps the existing signature when an update does not send one", async () => {
    const { service } = setup();
    await service.update("c1", FULL);
    const { signature: _s, ...withoutSignature } = FULL;
    expect(await service.update("c1", { ...withoutSignature, clinic: "City Clinic" })).toMatchObject({ hasSignature: true, complete: true, clinic: "City Clinic" });
  });

  it("lets optional fields be cleared with null but not the required ones", async () => {
    const { service } = setup();
    await service.update("c1", { ...FULL, clinic: "City Clinic", qualifications: "MPT" });
    expect(await service.update("c1", { clinic: null })).toMatchObject({ clinic: null, qualifications: "MPT" });
    await expect(service.update("c1", { fullName: "  " })).rejects.toThrow(BadRequestException);
    await expect(service.update("c1", { licenceNumber: null as never })).rejects.toThrow(BadRequestException);
  });

  it.each([
    ["blank name", { fullName: " " }],
    ["name too long", { fullName: "x".repeat(201) }],
    ["non-string licence", { licenceNumber: 5 }],
    ["optional too long", { clinic: "x".repeat(201) }],
  ])("rejects %s", async (_label, bad) => {
    const { service, prisma } = setup();
    await expect(service.update("c1", bad as never)).rejects.toThrow(BadRequestException);
    expect(prisma.clinician.update).not.toHaveBeenCalled();
  });

  it.each([
    ["empty strokes", { ...SIGNATURE, paths: [] }],
    ["no paths", { width: 300, height: 120 }],
    ["script in a stroke", { ...SIGNATURE, paths: ["M 0 0 <script>alert(1)</script>"] }],
    ["a non move/line command", { ...SIGNATURE, paths: ["M 0 0 C 10 10 20 20 30 30"] }],
    ["an image reference", { ...SIGNATURE, paths: ["url(http://x)"] }],
    ["too many strokes", { ...SIGNATURE, paths: Array.from({ length: 41 }, () => "M 0 0 L 1 1") }],
    ["a huge stroke", { ...SIGNATURE, paths: ["M 0 0" + " L 1 1".repeat(2000)] }],
    ["zero width", { ...SIGNATURE, width: 0 }],
    ["absurd height", { ...SIGNATURE, height: 99999 }],
    ["not an object", "scribble"],
  ])("rejects a signature with %s", async (_label, signature) => {
    const { service, prisma } = setup();
    await expect(service.update("c1", { signature: signature as never })).rejects.toThrow(BadRequestException);
    expect(prisma.clinician.update).not.toHaveBeenCalled();
  });

  it("404s for an unknown clinician", async () => {
    const { service } = setup(null);
    await expect(service.get("ghost")).rejects.toThrow(NotFoundException);
  });
});

describe("ClinicianProfileService.signerSnapshot", () => {
  it("refuses (409) while the profile is incomplete, whichever piece is missing", async () => {
    for (const missing of ["fullName", "specialty", "licenceNumber", "signature"] as const) {
      const { service } = setup();
      const { [missing]: _x, ...rest } = FULL;
      await service.update("c1", rest);
      await expect(service.signerSnapshot("c1")).rejects.toThrow(ConflictException);
    }
  });

  it("freezes name, specialty, licence and the signature with its hash", async () => {
    const { service } = setup();
    await service.update("c1", { ...FULL, qualifications: "MPT", clinic: "City Clinic" });
    const snapshot = await service.signerSnapshot("c1");
    expect(snapshot).toMatchObject({
      clinicianId: "c1", username: "drchen", fullName: "Dr Mei Chen", specialty: "Physiotherapy",
      licenceNumber: "PT-12345", qualifications: "MPT", clinic: "City Clinic", signature: SIGNATURE,
    });
    expect(snapshot.signatureSha256).toBe(signatureSha256(SIGNATURE));
    expect(snapshot.signatureSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot).not.toHaveProperty("licensingAuthority");
  });

  it("is a copy: editing the profile afterwards does not change an earlier snapshot", async () => {
    const { service } = setup();
    await service.update("c1", FULL);
    const before = await service.signerSnapshot("c1");
    await service.update("c1", { licenceNumber: "PT-99999" });
    expect(before.licenceNumber).toBe("PT-12345");
    expect((await service.signerSnapshot("c1")).licenceNumber).toBe("PT-99999");
  });

  it("hashes a different drawing differently", () => {
    expect(signatureSha256(SIGNATURE)).not.toBe(signatureSha256({ ...SIGNATURE, paths: ["M 0 0 L 1 1"] }));
  });

  it("treats an unreadable stored signature (wrong key) as no signature", async () => {
    const { service, row } = setup();
    await service.update("c1", FULL);
    row!.signatureEnc = new PatientCrypto(randomBytes(32).toString("base64")).encrypt("clinician_signature", "{}");
    await expect(service.signerSnapshot("c1")).rejects.toThrow(ConflictException);
  });
});

describe("ClinicianProfileService.registrarSnapshot", () => {
  it("carries name, licence and the signature hash, but not the drawing", async () => {
    const { service } = setup();
    await service.update("c1", FULL);
    const snapshot = await service.registrarSnapshot("c1");
    expect(snapshot).toMatchObject({ clinicianId: "c1", fullName: "Dr Mei Chen", licenceNumber: "PT-12345", signatureSha256: signatureSha256(SIGNATURE) });
    expect(snapshot.registeredAt).toEqual(expect.any(String));
    expect(JSON.stringify(snapshot)).not.toContain("M 10 10");
  });

  it("refuses (409) without a complete profile", async () => {
    const { service } = setup();
    await expect(service.registrarSnapshot("c1")).rejects.toThrow(ConflictException);
  });
});
