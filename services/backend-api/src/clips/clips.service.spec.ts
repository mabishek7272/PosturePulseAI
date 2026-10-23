import { BadRequestException, ConflictException, NotFoundException, UnsupportedMediaTypeException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BatteryService } from "../battery/battery.service";
import { ClipsService } from "./clips.service";

const battery = new BatteryService();

function sidecar(overrides: Record<string, unknown> = {}) {
  return {
    clipId: "c0ffee00-1111-4222-8333-444455556666",
    sessionId: "s1",
    stepId: "static.anterior",
    view: "anterior",
    recordedAt: "2026-10-23T10:00:00Z",
    nominalFps: 30,
    width: 1080,
    height: 1920,
    frames: [{ index: 0, t: 0, gravity: [0, 1, 0] }],
    device: { model: "iPad16,2", lens: "back_wide", appVersion: "1.0 (2)" },
    provenance: {
      schemaVersion: "clip-capture/v0",
      modelVersion: "ios-capture/1",
      calibrationVersion: "none/v0",
      producedAt: "2026-10-23T10:00:30Z",
    },
    ...overrides,
  };
}

function setup(state = "Observing") {
  const root = mkdtempSync(path.join(tmpdir(), "clips-"));
  const clipDir = path.join(root, "clips");
  const prisma = {
    clip: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...data })),
    },
  };
  const safety = { getState: jest.fn().mockResolvedValue(state) };
  const service = new ClipsService(prisma as never, safety as never, battery, clipDir);
  const upload = (bytes = "fake-video-bytes", mimetype = "video/quicktime") => {
    const file = path.join(root, `incoming-${Math.random().toString(16).slice(2)}`);
    writeFileSync(file, bytes);
    return { path: file, size: Buffer.byteLength(bytes), mimetype };
  };
  return { service, prisma, safety, clipDir, upload };
}

describe("ClipsService.accept", () => {
  it("stores the clip as <clipId>.mov, records its sha256 and queues one analysis job", async () => {
    const { service, prisma, clipDir, upload } = setup();
    const file = upload("hello-clip");
    const res = await service.accept("s1", "static.anterior", file, JSON.stringify(sidecar()));

    expect(res).toEqual({ clipId: "c0ffee00-1111-4222-8333-444455556666", status: "uploaded" });
    const finalPath = path.join(clipDir, "c0ffee00-1111-4222-8333-444455556666.mov");
    expect(readFileSync(finalPath, "utf-8")).toBe("hello-clip");
    expect(existsSync(file.path)).toBe(false);

    const data = prisma.clip.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      id: "c0ffee00-1111-4222-8333-444455556666",
      sessionId: "s1",
      stepId: "static.anterior",
      path: finalPath,
      sha256: createHash("sha256").update("hello-clip").digest("hex"),
      status: "uploaded",
    });
    expect(data.sidecar.frames).toHaveLength(1);
    expect(data.job).toEqual({ create: {} });
  });

  it.each(["Pause", "Unavailable", "ClinicianReview"])("answers 409 and keeps nothing when the session is in %s", async (state) => {
    const { service, prisma, clipDir, upload } = setup(state);
    const file = upload();
    await expect(service.accept("s1", "static.anterior", file, JSON.stringify(sidecar()))).rejects.toThrow(ConflictException);
    expect(prisma.clip.create).not.toHaveBeenCalled();
    expect(existsSync(file.path)).toBe(false);
    expect(existsSync(clipDir) ? readdirSync(clipDir).filter((f) => f.endsWith(".mov")) : []).toEqual([]);
  });

  it("rejects an unknown step", async () => {
    const { service, upload } = setup();
    await expect(
      service.accept("s1", "static.nope", upload(), JSON.stringify(sidecar({ stepId: "static.nope" })))
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects a file that is not mp4 or quicktime video", async () => {
    const { service, upload } = setup();
    await expect(
      service.accept("s1", "static.anterior", upload("x", "image/png"), JSON.stringify(sidecar()))
    ).rejects.toThrow(UnsupportedMediaTypeException);
  });

  it("accepts video/mp4", async () => {
    const { service, upload } = setup();
    await expect(
      service.accept("s1", "static.anterior", upload("x", "video/mp4"), JSON.stringify(sidecar()))
    ).resolves.toMatchObject({ status: "uploaded" });
  });

  it.each([
    ["missing", undefined],
    ["not JSON", "{nope"],
    ["not a ClipCapture", JSON.stringify({ clipId: "x" })],
  ])("rejects a sidecar that is %s", async (_label, raw) => {
    const { service, prisma, upload } = setup();
    const file = upload();
    await expect(service.accept("s1", "static.anterior", file, raw as string | undefined)).rejects.toThrow(BadRequestException);
    expect(prisma.clip.create).not.toHaveBeenCalled();
    expect(existsSync(file.path)).toBe(false);
  });

  it.each([
    ["sessionId", { sessionId: "other" }],
    ["stepId", { stepId: "static.posterior" }],
    ["view", { view: "posterior" }],
  ])("rejects a sidecar whose %s does not match the route", async (_label, override) => {
    const { service, upload } = setup();
    await expect(
      service.accept("s1", "static.anterior", upload(), JSON.stringify(sidecar(override)))
    ).rejects.toThrow(BadRequestException);
  });

  it.each(["../../etc/passwd", "a/b", "", "x".repeat(65), "a b"])("rejects clipId %p that is unsafe as a file name", async (clipId) => {
    const { service, upload } = setup();
    await expect(
      service.accept("s1", "static.anterior", upload(), JSON.stringify(sidecar({ clipId })))
    ).rejects.toThrow(BadRequestException);
  });

  it("is idempotent for a retried upload of the same clip", async () => {
    const { service, prisma, upload } = setup();
    prisma.clip.findUnique.mockResolvedValue({
      id: "c0ffee00-1111-4222-8333-444455556666",
      sessionId: "s1",
      stepId: "static.anterior",
      status: "analyzed",
      sha256: createHash("sha256").update("same").digest("hex"),
    });
    const file = upload("same");
    await expect(service.accept("s1", "static.anterior", file, JSON.stringify(sidecar()))).resolves.toEqual({
      clipId: "c0ffee00-1111-4222-8333-444455556666",
      status: "analyzed",
    });
    expect(prisma.clip.create).not.toHaveBeenCalled();
    expect(existsSync(file.path)).toBe(false);
  });

  it("answers 409 when the clipId already belongs to another session or different bytes", async () => {
    const { service, prisma, upload } = setup();
    prisma.clip.findUnique.mockResolvedValue({
      id: "c0ffee00-1111-4222-8333-444455556666",
      sessionId: "s2",
      stepId: "static.anterior",
      status: "uploaded",
      sha256: "0".repeat(64),
    });
    await expect(service.accept("s1", "static.anterior", upload(), JSON.stringify(sidecar()))).rejects.toThrow(ConflictException);
  });
});
