import { BadRequestException, ConflictException, NotFoundException, UnsupportedMediaTypeException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  const prisma: Record<string, any> = {
    clip: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...data })),
    },
  };
  prisma.$transaction = jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  const safety = { getState: jest.fn().mockResolvedValue(state) };
  // No step in the v0 battery sets requiresSpotter, so this stub is only
  // reached by the tests that opt into one; it defaults to "not confirmed" so a
  // spotter-requiring step is refused unless a test says otherwise.
  const spotter = { isConfirmed: jest.fn().mockResolvedValue(false) };
  const service = new ClipsService(prisma as never, safety as never, battery, spotter as never, clipDir);
  const upload = (bytes = "fake-video-bytes", mimetype = "video/quicktime") => {
    const file = path.join(root, `incoming-${Math.random().toString(16).slice(2)}`);
    writeFileSync(file, bytes);
    return { path: file, size: Buffer.byteLength(bytes), mimetype };
  };
  return { service, prisma, safety, spotter, clipDir, upload };
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

  describe("two uploads of the same new clipId at once", () => {
    const CLIP_ID = "c0ffee00-1111-4222-8333-444455556666";
    const p2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

    function raceSetup(winnerBytes: string, winnerRow: Record<string, unknown> | null) {
      const ctx = setup();
      // Both uploads passed the first lookup; the winner has since stored its file and row.
      mkdirSync(ctx.clipDir, { recursive: true });
      const winnerPath = path.join(ctx.clipDir, `${CLIP_ID}.mov`);
      writeFileSync(winnerPath, winnerBytes);
      ctx.prisma.clip.create.mockRejectedValue(p2002());
      ctx.prisma.clip.findUnique.mockResolvedValueOnce(null).mockResolvedValue(winnerRow);
      return { ...ctx, winnerPath };
    }

    it("answers the stored row when the winner is the same clip, and keeps the winner's file", async () => {
      const winnerRow = {
        id: CLIP_ID,
        sessionId: "s1",
        stepId: "static.anterior",
        status: "uploaded",
        sha256: createHash("sha256").update("same-bytes").digest("hex"),
      };
      const { service, upload, winnerPath } = raceSetup("same-bytes", winnerRow);
      const file = upload("same-bytes");
      await expect(service.accept("s1", "static.anterior", file, JSON.stringify(sidecar()))).resolves.toEqual({
        clipId: CLIP_ID,
        status: "uploaded",
      });
      expect(readFileSync(winnerPath, "utf-8")).toBe("same-bytes");
      expect(existsSync(file.path)).toBe(false);
    });

    it("answers 409, and leaves the winner's file alone, when the winner is different bytes", async () => {
      const winnerRow = {
        id: CLIP_ID,
        sessionId: "s1",
        stepId: "static.anterior",
        status: "uploaded",
        sha256: createHash("sha256").update("winner-bytes").digest("hex"),
      };
      const { service, upload, winnerPath } = raceSetup("winner-bytes", winnerRow);
      const file = upload("loser-bytes");
      await expect(service.accept("s1", "static.anterior", file, JSON.stringify(sidecar()))).rejects.toThrow(ConflictException);
      expect(readFileSync(winnerPath, "utf-8")).toBe("winner-bytes");
      expect(existsSync(file.path)).toBe(false);
    });

    it("does not touch the stored file before the row is created", async () => {
      const winnerRow = { id: CLIP_ID, sessionId: "s2", stepId: "static.anterior", status: "uploaded", sha256: "0".repeat(64) };
      const { service, upload, winnerPath } = raceSetup("winner-bytes", winnerRow);
      await expect(service.accept("s1", "static.anterior", upload("loser-bytes"), JSON.stringify(sidecar()))).rejects.toThrow(ConflictException);
      expect(readFileSync(winnerPath, "utf-8")).toBe("winner-bytes");
    });
  });

  it("removes the stored file and rethrows when the row cannot be created for another reason", async () => {
    const { service, prisma, clipDir, upload } = setup();
    prisma.clip.create.mockRejectedValue(new Error("db down"));
    await expect(service.accept("s1", "static.anterior", upload(), JSON.stringify(sidecar()))).rejects.toThrow("db down");
    expect(existsSync(clipDir) ? readdirSync(clipDir).filter((f) => f.endsWith(".mov")) : []).toEqual([]);
  });
});

describe("ClipsService.accept with a depth track (ADR-020)", () => {
  /** A sidecar depth block whose sha256 matches `bytes`. */
  function depthBlock(bytes: string, overrides: Record<string, unknown> = {}) {
    return {
      width: 256,
      height: 192,
      encoding: "uint16_millimetres_deflate",
      scaleMillimetres: 1,
      nominalFps: 15,
      frameCount: 2,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      hasConfidence: true,
      frames: [
        { index: 0, t: 0 },
        { index: 1, t: 0.067 },
      ],
      ...overrides,
    };
  }

  it("stores the depth track as <clipId>.depth and records depthPath on the row", async () => {
    const { service, prisma, clipDir, upload } = setup();
    const clip = upload("hello-clip");
    const depth = upload("depth-bytes", "application/octet-stream");

    const res = await service.accept(
      "s1",
      "static.anterior",
      clip,
      JSON.stringify(sidecar({ depth: depthBlock("depth-bytes") })),
      depth
    );

    expect(res.status).toBe("uploaded");
    const depthFinal = path.join(clipDir, "c0ffee00-1111-4222-8333-444455556666.depth");
    expect(readFileSync(depthFinal, "utf-8")).toBe("depth-bytes");
    expect(prisma.clip.create.mock.calls[0][0].data.depthPath).toBe(depthFinal);
    // Both temporaries consumed.
    expect(existsSync(clip.path)).toBe(false);
    expect(existsSync(depth.path)).toBe(false);
  });

  it("stores depthPath: null when no depth part is uploaded, leaving the 2D path untouched", async () => {
    const { service, prisma, upload } = setup();
    await service.accept("s1", "static.anterior", upload(), JSON.stringify(sidecar()));
    expect(prisma.clip.create.mock.calls[0][0].data.depthPath).toBeNull();
  });

  it("rejects a sidecar that declares depth with no depth part", async () => {
    const { service, prisma, upload } = setup();
    const clip = upload();
    await expect(
      service.accept("s1", "static.anterior", clip, JSON.stringify(sidecar({ depth: depthBlock("depth-bytes") })))
    ).rejects.toThrow(BadRequestException);
    expect(prisma.clip.create).not.toHaveBeenCalled();
    expect(existsSync(clip.path)).toBe(false);
  });

  it("rejects a depth part the sidecar does not describe", async () => {
    const { service, prisma, upload } = setup();
    const clip = upload();
    const depth = upload("depth-bytes", "application/octet-stream");
    await expect(service.accept("s1", "static.anterior", clip, JSON.stringify(sidecar()), depth)).rejects.toThrow(
      BadRequestException
    );
    expect(prisma.clip.create).not.toHaveBeenCalled();
    // An undescribed depth track must not be left on disk.
    expect(existsSync(depth.path)).toBe(false);
  });

  it("rejects a depth track whose bytes do not match the declared sha256", async () => {
    const { service, prisma, clipDir, upload } = setup();
    const clip = upload();
    const depth = upload("tampered-bytes", "application/octet-stream");
    await expect(
      service.accept("s1", "static.anterior", clip, JSON.stringify(sidecar({ depth: depthBlock("depth-bytes") })), depth)
    ).rejects.toThrow(/sha256/i);
    expect(prisma.clip.create).not.toHaveBeenCalled();
    expect(existsSync(depth.path)).toBe(false);
    expect(existsSync(clipDir) ? readdirSync(clipDir).filter((f) => f.endsWith(".depth")) : []).toEqual([]);
  });

  it("rejects a frameCount that disagrees with the frames array", async () => {
    const { service, prisma, upload } = setup();
    const depth = upload("depth-bytes", "application/octet-stream");
    await expect(
      service.accept(
        "s1",
        "static.anterior",
        upload(),
        JSON.stringify(sidecar({ depth: depthBlock("depth-bytes", { frameCount: 450 }) })),
        depth
      )
    ).rejects.toThrow(/frameCount/);
    expect(prisma.clip.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown depth encoding at the schema boundary", async () => {
    const { service, upload } = setup();
    const depth = upload("depth-bytes", "application/octet-stream");
    await expect(
      service.accept(
        "s1",
        "static.anterior",
        upload(),
        JSON.stringify(sidecar({ depth: depthBlock("depth-bytes", { encoding: "float32_raw" }) })),
        depth
      )
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects an unknown field inside the depth block instead of silently dropping it", async () => {
    const { service, upload } = setup();
    const depth = upload("depth-bytes", "application/octet-stream");
    await expect(
      service.accept(
        "s1",
        "static.anterior",
        upload(),
        JSON.stringify(sidecar({ depth: depthBlock("depth-bytes", { depthBias: 0.04 }) })),
        depth
      )
    ).rejects.toThrow(BadRequestException);
  });

  it("deletes both temporaries and leaves no .depth behind when the row cannot be created", async () => {
    const { service, prisma, clipDir, upload } = setup();
    prisma.clip.create.mockRejectedValueOnce(new Error("db down"));
    const clip = upload();
    const depth = upload("depth-bytes", "application/octet-stream");
    await expect(
      service.accept("s1", "static.anterior", clip, JSON.stringify(sidecar({ depth: depthBlock("depth-bytes") })), depth)
    ).rejects.toThrow("db down");
    expect(existsSync(clip.path)).toBe(false);
    expect(existsSync(depth.path)).toBe(false);
    expect(existsSync(clipDir) ? readdirSync(clipDir).filter((f) => f.endsWith(".depth")) : []).toEqual([]);
  });
});

describe("ClipsService and the HZ-09 spotter gate", () => {
  /** A battery whose one step demands a spotter, as a balance block would. */
  function spotterBattery() {
    return {
      step: (id: string) =>
        id === "balance.single_left_eyes_closed"
          ? {
              stepId: "balance.single_left_eyes_closed",
              module: "balance",
              title: "Stand on your left leg, eyes closed",
              instruction: "x",
              view: "anterior",
              kind: "hold",
              durationSeconds: 10,
              minFps: 24,
              levelToleranceDegrees: 6,
              modes: ["clinic"],
              metricKeys: [],
              requiresSpotter: true,
              eyesClosed: true,
              stance: "single_left",
            }
          : battery.step(id),
    };
  }

  function setupSpotter(confirmed: boolean) {
    const root = mkdtempSync(path.join(tmpdir(), "spotter-"));
    const clipDir = path.join(root, "clips");
    const prisma: Record<string, any> = {
      clip: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...data })),
      },
    };
    prisma.$transaction = jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
    const safety = { getState: jest.fn().mockResolvedValue("Observing") };
    const spotter = { isConfirmed: jest.fn().mockResolvedValue(confirmed) };
    const service = new ClipsService(
      prisma as never,
      safety as never,
      spotterBattery() as never,
      spotter as never,
      clipDir
    );
    const file = path.join(root, "incoming");
    writeFileSync(file, "bytes");
    return {
      service,
      prisma,
      spotter,
      clipDir,
      file: { path: file, size: 5, mimetype: "video/quicktime" },
    };
  }

  const side = () =>
    JSON.stringify(
      sidecar({ stepId: "balance.single_left_eyes_closed", view: "anterior" })
    );

  it("refuses a clip for a requiresSpotter step with no confirmation", async () => {
    // The structural half of HZ-09. The app will not offer the shutter without
    // an attestation, but an app is a client - an old build, a modified build,
    // or simply wrong. This is what stops a bypassed prompt reaching the record.
    const { service, prisma, file, clipDir } = setupSpotter(false);
    await expect(
      service.accept("s1", "balance.single_left_eyes_closed", file, side())
    ).rejects.toThrow(ConflictException);
    expect(prisma.clip.create).not.toHaveBeenCalled();
    // And nothing is left on disk.
    expect(existsSync(file.path)).toBe(false);
    expect(existsSync(clipDir) ? readdirSync(clipDir) : []).toEqual([]);
  });

  it("names the step and what is needed, so the message is actionable", async () => {
    const { service, file } = setupSpotter(false);
    await expect(
      service.accept("s1", "balance.single_left_eyes_closed", file, side())
    ).rejects.toThrow(/within arm's reach/);
  });

  it("accepts the clip once a confirmation exists for that session and step", async () => {
    const { service, prisma, spotter, file } = setupSpotter(true);
    const res = await service.accept("s1", "balance.single_left_eyes_closed", file, side());
    expect(res.status).toBe("uploaded");
    expect(prisma.clip.create).toHaveBeenCalled();
    // Checked per STEP, never per session: one tick must not cover a step the
    // clinician never saw.
    expect(spotter.isConfirmed).toHaveBeenCalledWith("s1", "balance.single_left_eyes_closed");
  });

  it("does not consult the spotter gate for a step that does not need one", async () => {
    // Every step in the v0 battery is a quiet standing hold. Calling the gate
    // for them would add a query per upload and, worse, invite someone to make
    // the default "confirmed".
    const { service, spotter, upload } = setup();
    await service.accept("s1", "static.anterior", upload(), JSON.stringify(sidecar()));
    expect(spotter.isConfirmed).not.toHaveBeenCalled();
  });

  it("checks the safety state before the spotter gate", async () => {
    // Order matters: a paused session must answer 409 for the pause, not for a
    // missing spotter, or the clinician is sent to fix the wrong thing.
    const { service, file } = setupSpotter(false);
    const paused = new ClipsService(
      { clip: { findUnique: jest.fn(), create: jest.fn() } } as never,
      { getState: jest.fn().mockResolvedValue("Pause") } as never,
      spotterBattery() as never,
      { isConfirmed: jest.fn().mockResolvedValue(false) } as never,
      "/tmp/nowhere"
    );
    await expect(
      paused.accept("s1", "balance.single_left_eyes_closed", file, side())
    ).rejects.toThrow(/clinician resumes/);
  });
});
