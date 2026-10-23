import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PatientCrypto } from "./patient-crypto";
import { PatientsService } from "./patients.service";

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
  return { service: new PatientsService(prisma as never, crypto), prisma, patients, crypto };
}

const input = { name: "Ada Example", dateOfBirth: "1980-02-29", contact: "ada@example.test" };

describe("PatientsService.create", () => {
  it("stores every identifying field as ciphertext and returns the plain record", async () => {
    const { service, patients, crypto } = setup();
    const created = await service.create(input, "clin1");
    expect(created).toEqual({ id: "p1", name: "Ada Example", dateOfBirth: "1980-02-29", contact: "ada@example.test", createdAt: expect.any(Date) });

    const row = patients[0];
    expect(row.createdBy).toBe("clin1");
    expect(JSON.stringify(row)).not.toMatch(/Ada|1980|example\.test/);
    expect(crypto.decrypt("name", row.nameEnc)).toBe("Ada Example");
    expect(crypto.decrypt("dob", row.dobEnc)).toBe("1980-02-29");
    expect(crypto.decrypt("contact", row.contactEnc)).toBe("ada@example.test");
  });

  it("makes contact optional", async () => {
    const { service, patients } = setup();
    const created = await service.create({ name: "Ben", dateOfBirth: "1990-01-01" }, "clin1");
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

describe("PatientsService.search", () => {
  it("decrypts, then filters by name or contact, case-insensitively", async () => {
    const { service } = setup();
    await service.create({ name: "Ada Example", dateOfBirth: "1980-02-29", contact: "ada@example.test" }, "c");
    await service.create({ name: "Ben Other", dateOfBirth: "1990-01-01", contact: "07700 900123" }, "c");
    expect((await service.search("ADA")).map((p) => p.name)).toEqual(["Ada Example"]);
    expect((await service.search("900123")).map((p) => p.name)).toEqual(["Ben Other"]);
    expect(await service.search("zzz")).toEqual([]);
  });

  it("lists all (sorted by name) when q is empty", async () => {
    const { service } = setup();
    await service.create({ name: "Ben", dateOfBirth: "1990-01-01" }, "c");
    await service.create({ name: "Ada", dateOfBirth: "1980-01-01" }, "c");
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
    await service.create({ name: "Ada", dateOfBirth: "1980-01-01" }, "c");
    patients.push({ id: "bad", createdAt: new Date(), createdBy: "c", nameEnc: "garbage", dobEnc: "garbage", contactEnc: null });
    expect((await service.search("")).map((p) => p.name)).toEqual(["Ada"]);
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
    await service.create({ name: "Ben", dateOfBirth: "1990-01-01" }, "c");
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
