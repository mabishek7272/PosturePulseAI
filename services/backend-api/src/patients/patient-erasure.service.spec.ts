import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PatientCrypto } from "./patient-crypto";
import { PatientErasureService } from "./patient-erasure.service";

async function setup(opts: { adverse?: number } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "erase-"));
  const crypto = new PatientCrypto(randomBytes(32).toString("base64"));
  const video = path.join(dir, "c1.mov");
  const depth = path.join(dir, "c1.depth");
  const lm = path.join(dir, "landmarks", "c1");
  await writeFile(video, "v");
  await writeFile(depth, "d");
  await mkdir(lm, { recursive: true });
  await writeFile(path.join(lm, "x.json.gz"), "l");
  const calls: string[] = [];
  const del = (name: string, count = 1) => jest.fn().mockImplementation(() => { calls.push(name); return Promise.resolve({ count }); });
  const tx = {
    analysisJob: { deleteMany: del("job") },
    clip: { deleteMany: del("clip") },
    event: { deleteMany: del("event", 5) },
    assessmentReport: { deleteMany: del("report", 2) },
    session: { deleteMany: del("session") },
    consentRecord: { deleteMany: del("consent") },
    patientSubjectLink: { deleteMany: del("link") },
    patient: { delete: jest.fn().mockImplementation(() => { calls.push("patient"); return Promise.resolve({}); }) },
  };
  const prisma = {
    patient: { findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve(where.id === "p1" ? { id: "p1", nameEnc: crypto.encrypt("name", "Ada Example") } : null)) },
    patientSubjectLink: { findMany: jest.fn().mockResolvedValue([{ subjectPseudoId: "sub-1" }]) },
    session: { findMany: jest.fn().mockResolvedValue([{ id: "s1" }]) },
    adverseEvent: { count: jest.fn().mockResolvedValue(opts.adverse ?? 0) },
    clip: { findMany: jest.fn().mockResolvedValue([{ id: "c1", path: video, depthPath: depth }]) },
    $transaction: jest.fn().mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  return { service: new PatientErasureService(prisma as never, crypto, dir), prisma, tx, calls, dir, video, depth, lm };
}

describe("PatientErasureService", () => {
  it("erases database rows in dependency order and removes every file on disk", async () => {
    const t = await setup();
    const out = await t.service.erase("p1", "  ada example ");
    expect(t.calls).toEqual(["job", "clip", "event", "report", "session", "consent", "link", "patient"]);
    expect(out).toMatchObject({ patientId: "p1", sessions: 1, clips: 1, reports: 2, events: 5, filesRemoved: 3 });
    expect([t.video, t.depth, t.lm].some(existsSync)).toBe(false);
    await rm(t.dir, { recursive: true, force: true });
  });

  it("refuses without the exact name and changes nothing", async () => {
    const t = await setup();
    for (const wrong of [undefined, "", "Ada", "Ben Other", 42]) {
      await expect(t.service.erase("p1", wrong)).rejects.toThrow(BadRequestException);
    }
    expect(t.prisma.$transaction).not.toHaveBeenCalled();
    expect(existsSync(t.video)).toBe(true);
    await rm(t.dir, { recursive: true, force: true });
  });

  it("refuses a patient with adverse-event records", async () => {
    const t = await setup({ adverse: 1 });
    await expect(t.service.erase("p1", "Ada Example")).rejects.toThrow(ConflictException);
    expect(t.prisma.$transaction).not.toHaveBeenCalled();
    expect(existsSync(t.video)).toBe(true);
    await rm(t.dir, { recursive: true, force: true });
  });

  it("is 404 for an unknown patient", async () => {
    const t = await setup();
    await expect(t.service.erase("nope", "x")).rejects.toThrow(NotFoundException);
    await rm(t.dir, { recursive: true, force: true });
  });

  it("keeps the files when the transaction fails, so nothing is half-erased", async () => {
    const t = await setup();
    t.prisma.$transaction.mockRejectedValueOnce(new Error("db down"));
    await expect(t.service.erase("p1", "Ada Example")).rejects.toThrow("db down");
    expect(existsSync(t.video)).toBe(true);
    await rm(t.dir, { recursive: true, force: true });
  });
});
