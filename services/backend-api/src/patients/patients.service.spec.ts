import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PatientCrypto } from "./patient-crypto";
import { PatientsService } from "./patients.service";

const REQUIRED_ANSWERS = {
  nationality: "Indian",
  sexAtBirth: "female" as const,
  genderIdentity: "woman" as const,
  smoking: "never" as const,
  alcohol: "never" as const,
};

const REGISTRAR = { clinicianId: "clin1", fullName: "Dr Mei Chen", licenceNumber: "PT-12345", signatureSha256: "a".repeat(64), registeredAt: "2026-11-23T00:00:00.000Z" };

function setup() {
  const crypto = new PatientCrypto(randomBytes(32).toString("base64"));
  const patients: any[] = [];
  const links: any[] = [];
  const sessions: any[] = [{ id: "s1", subjectPseudoId: "pseudo-1", state: "Observing", createdAt: new Date(1), deploymentContext: "clinic_supervised", protocolId: "x" }];
  let n = 0;
  const prisma = {
    patient: {
      create: jest.fn().mockImplementation(({ data }) => {
        const row = { id: `p${++n}`, createdAt: new Date(n), contactEnc: null, ...data };
        patients.push(row);
        return Promise.resolve(row);
      }),
      findMany: jest.fn().mockImplementation(() => Promise.resolve([...patients])),
      findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve(patients.find((p) => p.id === where.id) ?? null)),
    },
    patientSubjectLink: {
      findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve(links.find((l) => l.subjectPseudoId === where.subjectPseudoId) ?? null)),
      create: jest.fn().mockImplementation(({ data }) => {
        links.push(data);
        return Promise.resolve(data);
      }),
      findMany: jest.fn().mockImplementation(({ where }) => Promise.resolve(links.filter((l) => l.patientId === where.patientId))),
    },
    session: {
      findFirst: jest.fn().mockImplementation(({ where }) => Promise.resolve(sessions.find((s) => s.subjectPseudoId === where.subjectPseudoId) ?? null)),
      findMany: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(sessions.filter((s) => where.subjectPseudoId.in.includes(s.subjectPseudoId)))
      ),
    },
  };
  const profiles = { registrarSnapshot: jest.fn().mockResolvedValue(REGISTRAR) };
  return { service: new PatientsService(prisma as never, crypto, profiles as never), prisma, patients, crypto, profiles };
}

const input = { name: "Ada Example", dateOfBirth: "1980-02-29", contact: "ada@example.test", intake: REQUIRED_ANSWERS };

describe("PatientsService.create", () => {
  it("stores every identifying field as ciphertext and returns the plain record", async () => {
    const { service, patients, crypto } = setup();
    const created = await service.create(input, "clin1");
    expect(created).toEqual({
      id: "p1",
      name: "Ada Example",
      dateOfBirth: "1980-02-29",
      contact: "ada@example.test",
      intake: REQUIRED_ANSWERS,
      registeredBy: { fullName: "Dr Mei Chen", licenceNumber: "PT-12345", registeredAt: REGISTRAR.registeredAt },
      createdAt: expect.any(Date),
    });

    const row = patients[0];
    expect(row.createdBy).toBe("clin1");
    expect(JSON.stringify(row)).not.toMatch(/Ada|1980|example\.test/);
    expect(crypto.decrypt("name", row.nameEnc)).toBe("Ada Example");
    expect(crypto.decrypt("dob", row.dobEnc)).toBe("1980-02-29");
    expect(crypto.decrypt("contact", row.contactEnc)).toBe("ada@example.test");
  });

  it("makes contact optional", async () => {
    const { service, patients } = setup();
    const created = await service.create({ intake: REQUIRED_ANSWERS, name: "Ben", dateOfBirth: "1990-01-01" }, "clin1");
    expect(created.contact).toBeNull();
    expect(patients[0].contactEnc).toBeNull();
  });

  it.each([
    ["blank name", { ...input, name: "  " }],
    ["name too long", { ...input, name: "x".repeat(201) }],
    ["missing date of birth", { ...input, dateOfBirth: undefined }],
    ["date of birth not ISO", { ...input, dateOfBirth: "29/02/1980" }],
    ["impossible date", { ...input, dateOfBirth: "1981-02-29" }],
    ["future date", { ...input, dateOfBirth: "2999-01-01" }],
    ["contact too long", { ...input, contact: "x".repeat(201) }],
    ["non-string name", { ...input, name: 5 }],
  ])("rejects %s", async (_label, body) => {
    const { service, prisma } = setup();
    await expect(service.create(body as never, "clin1")).rejects.toThrow(BadRequestException);
    expect(prisma.patient.create).not.toHaveBeenCalled();
  });
});

describe("PatientsService.create - intake", () => {
  const intake = {
    ...REQUIRED_ANSWERS,
    heightCm: 172,
    weightKg: 68,
    smoking: "former" as const,
    alcohol: "occasional" as const,
    physicalActivityLevel: "moderate" as const,
    physicalProblems: "Lower back ache for 2 weeks",
    recentAccident: true,
    recentAccidentDetails: "Slipped on stairs, no fracture",
  };

  it("stores intake as ciphertext and round-trips it exactly", async () => {
    const { service, patients, crypto } = setup();
    const created = await service.create({ ...input, intake }, "clin1");
    expect(created.intake).toEqual(intake);

    const row = patients[0];
    expect(JSON.stringify(row)).not.toMatch(/Slipped|back ache/);
    expect(JSON.parse(crypto.decrypt("intake", row.intakeEnc))).toEqual(intake);
  });

  it("keeps the other intake fields optional: only the required answers are needed", async () => {
    const { service } = setup();
    const created = await service.create({ ...input, intake: { ...REQUIRED_ANSWERS, heightCm: 180 } }, "clin1");
    expect(created.intake).toEqual({ ...REQUIRED_ANSWERS, heightCm: 180 });
  });

  it.each([
    ["height too low", { heightCm: 10 }],
    ["height too high", { heightCm: 300 }],
    ["weight not a number", { weightKg: "heavy" }],
    ["smoking not one of the allowed values", { smoking: "sometimes" }],
    ["alcohol not one of the allowed values", { alcohol: "lots" }],
    ["activity level not one of the allowed values", { physicalActivityLevel: "extreme" }],
    ["recentAccident not a boolean", { recentAccident: "yes" }],
  ])("rejects %s", async (_label, badIntake) => {
    const { service, prisma } = setup();
    await expect(service.create({ ...input, intake: { ...REQUIRED_ANSWERS, ...badIntake } as never }, "clin1")).rejects.toThrow(BadRequestException);
    expect(prisma.patient.create).not.toHaveBeenCalled();
  });

  it("truncates an over-long free-text note rather than rejecting the whole patient", async () => {
    const { service } = setup();
    const created = await service.create(
      { ...input, intake: { ...REQUIRED_ANSWERS, physicalProblems: "x".repeat(1000) } },
      "clin1"
    );
    expect(created.intake?.physicalProblems).toHaveLength(500);
  });
});

describe("PatientsService.create - required answers and registrar", () => {
  it.each(["nationality", "sexAtBirth", "genderIdentity", "smoking", "alcohol"] as const)("refuses a patient with no %s", async (field) => {
    const { service, prisma } = setup();
    const { [field]: _dropped, ...rest } = REQUIRED_ANSWERS;
    await expect(service.create({ ...input, intake: rest as never }, "clin1")).rejects.toThrow(new RegExp(`intake\\.${field}`));
    expect(prisma.patient.create).not.toHaveBeenCalled();
  });

  it("refuses a patient with no intake at all, naming every missing answer", async () => {
    const { service } = setup();
    await expect(service.create({ name: "Ben", dateOfBirth: "1990-01-01" }, "clin1")).rejects.toThrow(/nationality.*sexAtBirth.*genderIdentity.*smoking.*alcohol/);
  });

  it("accepts 'prefer not to say' as an answer to sex at birth and gender identity", async () => {
    const { service } = setup();
    const created = await service.create(
      { ...input, intake: { ...REQUIRED_ANSWERS, sexAtBirth: "prefer_not_to_say", genderIdentity: "prefer_not_to_say" } },
      "clin1"
    );
    expect(created.intake).toMatchObject({ sexAtBirth: "prefer_not_to_say", genderIdentity: "prefer_not_to_say" });
  });

  it.each([
    ["blank nationality", { nationality: "  " }],
    ["nationality too long", { nationality: "x".repeat(101) }],
    ["unknown sex at birth", { sexAtBirth: "unknown" }],
    ["unknown gender identity", { genderIdentity: "x" }],
  ])("rejects %s", async (_label, bad) => {
    const { service } = setup();
    await expect(service.create({ ...input, intake: { ...REQUIRED_ANSWERS, ...bad } as never }, "clin1")).rejects.toThrow(BadRequestException);
  });

  it("stamps the registering doctor's licence and signature hash from their server-side profile", async () => {
    const { service, patients, profiles } = setup();
    const created = await service.create(input, "clin1");
    expect(profiles.registrarSnapshot).toHaveBeenCalledWith("clin1");
    expect(patients[0].registrarSnapshot).toEqual(REGISTRAR);
    expect(created.registeredBy).toEqual({ fullName: "Dr Mei Chen", licenceNumber: "PT-12345", registeredAt: REGISTRAR.registeredAt });
    // The signature hash is a server-side fact: it is not echoed to the client.
    expect(JSON.stringify(created)).not.toContain("a".repeat(64));
  });

  it("ignores a registrar the client tries to supply", async () => {
    const { service, patients } = setup();
    await service.create({ ...input, registrarSnapshot: { licenceNumber: "FAKE" } } as never, "clin1");
    expect(patients[0].registrarSnapshot.licenceNumber).toBe("PT-12345");
  });

  it("refuses to register a patient while the doctor's profile is incomplete, storing nothing", async () => {
    const { service, prisma, profiles } = setup();
    profiles.registrarSnapshot.mockRejectedValueOnce(new ConflictException("Complete your doctor profile first."));
    await expect(service.create(input, "clin1")).rejects.toThrow(ConflictException);
    expect(prisma.patient.create).not.toHaveBeenCalled();
  });

  it("still reads an older record that has no registrar or new intake answers", async () => {
    const { service, patients, crypto } = setup();
    patients.push({
      id: "old1",
      createdAt: new Date(0),
      nameEnc: crypto.encrypt("name", "Old Patient"),
      dobEnc: crypto.encrypt("dob", "1970-01-01"),
      contactEnc: null,
      intakeEnc: crypto.encrypt("intake", JSON.stringify({ smoking: "never" })),
    });
    const record = await service.get("old1");
    expect(record.registeredBy).toBeNull();
    expect(record.intake).toEqual({ smoking: "never" });
  });
});

describe("PatientsService.search", () => {
  it("decrypts, then filters by name or contact, case-insensitively", async () => {
    const { service } = setup();
    await service.create({ intake: REQUIRED_ANSWERS, name: "Ada Example", dateOfBirth: "1980-02-29", contact: "ada@example.test" }, "c");
    await service.create({ intake: REQUIRED_ANSWERS, name: "Ben Other", dateOfBirth: "1990-01-01", contact: "07700 900123" }, "c");
    expect((await service.search("ADA")).map((p) => p.name)).toEqual(["Ada Example"]);
    expect((await service.search("900123")).map((p) => p.name)).toEqual(["Ben Other"]);
    expect(await service.search("zzz")).toEqual([]);
  });

  it("lists all (sorted by name) when q is empty", async () => {
    const { service } = setup();
    await service.create({ intake: REQUIRED_ANSWERS, name: "Ben", dateOfBirth: "1990-01-01" }, "c");
    await service.create({ intake: REQUIRED_ANSWERS, name: "Ada", dateOfBirth: "1980-01-01" }, "c");
    expect((await service.search(undefined)).map((p) => p.name)).toEqual(["Ada", "Ben"]);
  });

  it("returns at most 200 patients", async () => {
    const { service, patients, crypto } = setup();
    for (let i = 0; i < 205; i++) {
      patients.push({ id: `x${i}`, createdAt: new Date(i), createdBy: "c", nameEnc: crypto.encrypt("name", `Person ${String(i).padStart(3, "0")}`), dobEnc: crypto.encrypt("dob", "1990-01-01"), contactEnc: null });
    }
    expect(await service.search("")).toHaveLength(200);
  });

  it("skips a row it cannot decrypt instead of failing the whole search", async () => {
    const { service, patients } = setup();
    await service.create({ intake: REQUIRED_ANSWERS, name: "Ada", dateOfBirth: "1980-01-01" }, "c");
    patients.push({ id: "bad", createdAt: new Date(), createdBy: "c", nameEnc: "garbage", dobEnc: "garbage", contactEnc: null });
    expect((await service.search("")).map((p) => p.name)).toEqual(["Ada"]);
  });

  it("silently excludes a self-signup patient (no clinician-entered name/DOB yet) from results", async () => {
    const { service, patients } = setup();
    await service.create({ intake: REQUIRED_ANSWERS, name: "Ada", dateOfBirth: "1980-01-01" }, "c");
    patients.push({ id: "selfsignup", createdAt: new Date(), createdBy: null, nameEnc: null, dobEnc: null, contactEnc: null, email: "ada@self.test", passwordHash: "hash" });
    await expect(service.search("")).resolves.not.toThrow();
    expect((await service.search("")).map((p) => p.name)).toEqual(["Ada"]);
  });
});

describe("PatientsService.get", () => {
  it("returns one decrypted record", async () => {
    const { service } = setup();
    const created = await service.create(input, "c");
    await expect(service.get(created.id)).resolves.toMatchObject({ id: created.id, name: "Ada Example", dateOfBirth: "1980-02-29" });
  });

  it("is 404 for an unknown id and for a self-signup row with no clinician-entered identity", async () => {
    const { service, patients } = setup();
    await expect(service.get("nope")).rejects.toThrow(NotFoundException);
    patients.push({ id: "selfsignup", createdAt: new Date(), createdBy: null, nameEnc: null, dobEnc: null, contactEnc: null });
    await expect(service.get("selfsignup")).rejects.toThrow(NotFoundException);
  });
});

describe("PatientsService.subjectNames", () => {
  it("maps linked visit codes to patient names and leaves unlinked ones out", async () => {
    const { service, prisma, patients } = setup();
    const ada = await service.create({ intake: REQUIRED_ANSWERS, name: "Ada Example", dateOfBirth: "1980-02-29" }, "c");
    const row = patients.find((p) => p.id === ada.id);
    (prisma.patientSubjectLink as any).findMany = jest.fn().mockResolvedValue([
      { subjectPseudoId: "sub-1", patientId: ada.id, patient: row },
      { subjectPseudoId: "sub-2", patientId: "gone", patient: null },
    ]);
    expect(await service.subjectNames()).toEqual({ "sub-1": { patientId: ada.id, name: "Ada Example" } });
  });
});

describe("PatientsService.link", () => {
  it("links a pseudonymous subject id that has a session to the patient", async () => {
    const { service, prisma } = setup();
    await service.create(input, "c");
    await expect(service.link("p1", "pseudo-1")).resolves.toEqual({ patientId: "p1", subjectPseudoId: "pseudo-1" });
    expect(prisma.patientSubjectLink.create).toHaveBeenCalledWith({ data: { patientId: "p1", subjectPseudoId: "pseudo-1" } });
  });

  it("is idempotent for the same patient", async () => {
    const { service, prisma } = setup();
    await service.create(input, "c");
    await service.link("p1", "pseudo-1");
    await service.link("p1", "pseudo-1");
    expect(prisma.patientSubjectLink.create).toHaveBeenCalledTimes(1);
  });

  it("refuses a subject already linked to another patient", async () => {
    const { service } = setup();
    await service.create(input, "c");
    await service.create({ intake: REQUIRED_ANSWERS, name: "Ben", dateOfBirth: "1990-01-01" }, "c");
    await service.link("p1", "pseudo-1");
    await expect(service.link("p2", "pseudo-1")).rejects.toThrow(ConflictException);
  });

  it("is 404 for an unknown patient or a subject with no session", async () => {
    const { service } = setup();
    await service.create(input, "c");
    await expect(service.link("nope", "pseudo-1")).rejects.toThrow(NotFoundException);
    await expect(service.link("p1", "pseudo-unknown")).rejects.toThrow(NotFoundException);
  });

  it("requires a subjectPseudoId", async () => {
    const { service } = setup();
    await service.create(input, "c");
    await expect(service.link("p1", "" as never)).rejects.toThrow(BadRequestException);
  });
});

describe("PatientsService.sessions", () => {
  it("lists the linked sessions without any identifier", async () => {
    const { service } = setup();
    await service.create(input, "c");
    await service.link("p1", "pseudo-1");
    const sessions = await service.sessions("p1");
    expect(sessions).toEqual([
      { id: "s1", state: "Observing", createdAt: new Date(1), deploymentContext: "clinic_supervised", protocolId: "x" },
    ]);
  });

  it("is empty when nothing is linked and 404 for an unknown patient", async () => {
    const { service } = setup();
    await service.create(input, "c");
    await expect(service.sessions("p1")).resolves.toEqual([]);
    await expect(service.sessions("nope")).rejects.toThrow(NotFoundException);
  });
});
