import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { INestApplication } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SessionOwnershipGuard } from "../auth/session-ownership.guard";
import { BatteryService } from "../battery/battery.service";
import { PrismaService } from "../common/prisma.service";
import { SafetyService } from "../safety/safety.service";
import { ClipUploadStateGuard } from "./clip-upload-state.guard";
import { ClipsController } from "./clips.controller";
import { ClipsService } from "./clips.service";

const sidecar = (overrides: Record<string, unknown> = {}) => ({
  clipId: "clip-1",
  sessionId: "s1",
  stepId: "static.anterior",
  view: "anterior",
  recordedAt: "2026-10-23T10:00:00Z",
  nominalFps: 30,
  width: 1080,
  height: 1920,
  frames: [{ index: 0, t: 0, gravity: [0, 1, 0] }],
  device: { model: "iPad16,2", lens: "back_wide", appVersion: "1.0 (2)" },
  provenance: { schemaVersion: "clip-capture/v0", modelVersion: "ios/1", calibrationVersion: "none/v0", producedAt: "2026-10-23T10:00:30Z" },
  ...overrides,
});

describe("PUT /sessions/:id/clips/:stepId", () => {
  let app: INestApplication;
  let jwt: JwtService;
  let state = "Observing";
  let clipDir: string;
  const created: Array<{ data: Record<string, unknown> }> = [];

  beforeAll(async () => {
    clipDir = path.join(mkdtempSync(path.join(tmpdir(), "clip-route-")), "clips");
    process.env.CLIP_DIR = clipDir;
    const prisma = {
      clip: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((args) => {
          created.push(args);
          return Promise.resolve({ ...args.data });
        }),
      },
    };
    const safety = { getState: jest.fn().mockImplementation(() => Promise.resolve(state)) };
    const battery = new BatteryService();
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: "test-secret" })],
      controllers: [ClipsController],
      providers: [
        JwtAuthGuard,
        SessionOwnershipGuard,
        ClipUploadStateGuard,
        { provide: SafetyService, useValue: safety },
        { provide: PrismaService, useValue: prisma },
        { provide: BatteryService, useValue: battery },
        { provide: ClipsService, useValue: new ClipsService(prisma as never, safety as never, battery, clipDir) },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => app.close());
  beforeEach(() => {
    state = "Observing";
    created.length = 0;
  });

  const token = (role = "subject", sessionId = "s1") => jwt.sign({ sub: "p1", sessionId, role });

  it("is guarded by a subject token for the same session, then the safety-state check", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ClipsController.prototype.upload);
    expect(guards).toEqual([JwtAuthGuard, SessionOwnershipGuard, ClipUploadStateGuard]);
  });

  it("stores the clip and answers {clipId, status} (sidecar sent as a text field)", async () => {
    const res = await request(app.getHttpServer())
      .put("/sessions/s1/clips/static.anterior")
      .set("Authorization", `Bearer ${token()}`)
      .field("sidecar", JSON.stringify(sidecar()))
      .attach("clip", Buffer.from("video-bytes"), { filename: "c.mov", contentType: "video/quicktime" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ clipId: "clip-1", status: "uploaded" });
    expect(readdirSync(clipDir).filter((f) => f.endsWith(".mov"))).toEqual(["clip-1.mov"]);
    expect(created).toHaveLength(1);
  });

  it("accepts the sidecar as a JSON file part too", async () => {
    const res = await request(app.getHttpServer())
      .put("/sessions/s1/clips/static.anterior")
      .set("Authorization", `Bearer ${token()}`)
      .attach("sidecar", Buffer.from(JSON.stringify(sidecar({ clipId: "clip-2" }))), { filename: "s.json", contentType: "application/json" })
      .attach("clip", Buffer.from("video-bytes"), { filename: "c.mov", contentType: "video/mp4" });
    expect(res.status).toBe(200);
    expect(res.body.clipId).toBe("clip-2");
  });

  it.each(["Pause", "Unavailable", "ClinicianReview"])("answers 409 in %s before reading the upload", async (s) => {
    state = s;
    const res = await request(app.getHttpServer())
      .put("/sessions/s1/clips/static.anterior")
      .set("Authorization", `Bearer ${token()}`)
      .field("sidecar", JSON.stringify(sidecar({ clipId: "clip-409" })))
      .attach("clip", Buffer.from("video-bytes"), { filename: "c.mov", contentType: "video/quicktime" });
    expect(res.status).toBe(409);
    expect(created).toHaveLength(0);
  });

  it("answers 401 without a token and 403 for another session's token or a non-subject role", async () => {
    const put = () => request(app.getHttpServer()).put("/sessions/s1/clips/static.anterior");
    expect((await put()).status).toBe(401);
    expect((await put().set("Authorization", `Bearer ${token("subject", "s2")}`)).status).toBe(403);
    expect((await put().set("Authorization", `Bearer ${token("report_reader")}`)).status).toBe(403);
  });

  it("answers 400 when the clip part is missing", async () => {
    const res = await request(app.getHttpServer())
      .put("/sessions/s1/clips/static.anterior")
      .set("Authorization", `Bearer ${token()}`)
      .field("sidecar", JSON.stringify(sidecar()));
    expect(res.status).toBe(400);
  });

  it("answers 400 when the sidecar names another step than the route", async () => {
    const res = await request(app.getHttpServer())
      .put("/sessions/s1/clips/static.anterior")
      .set("Authorization", `Bearer ${token()}`)
      .field("sidecar", JSON.stringify(sidecar({ stepId: "static.posterior", clipId: "clip-3" })))
      .attach("clip", Buffer.from("v"), { filename: "c.mov", contentType: "video/quicktime" });
    expect(res.status).toBe(400);
    expect(readdirSync(path.join(clipDir, "incoming"))).toEqual([]);
  });
});
