# Piece 1 — Session Token, Consent Enforcement, Socket.IO Client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the iOS app's hardcoded subject/consent placeholders with a real pseudonymous id + consent flow, issue a session-scoped token at session creation, and require that token on every subject-facing route and on the live Socket.IO channel.

**Architecture:** `POST /sessions` validates the consent record and returns `{ session, sessionToken }` (JWT, `role: "subject"`, 4 h). `JwtAuthGuard` + new `SessionOwnershipGuard` protect subject routes; `SessionGateway` checks a token on connect. `POST /symptom-reports` is the one deliberate exception: it is never rejected for auth (pausing is the fail-safe direction, CLAUDE.md rule 2) and only logs unauthenticated reports. iOS stores a random UUID in Keychain, collects consent, and attaches the token to REST and Socket.IO (`socket.io-client-swift`).

**Tech Stack:** NestJS 10 + `@nestjs/jwt` + Jest (backend-api); React/Vite + socket.io-client 4 (clinician-web); Swift 5.9 / SwiftUI / XCTest + socket.io-client-swift 16 (ios-client).

Spec: `docs/superpowers/specs/2026-10-01-posture-report-design.md` §9.

---

## Environment notes (read first)

- This Mac's Node (`~/.nvm/.../v20.20.2`) has no `npm`. A working npm is at
  `$SCRATCH/bin/npm` where
  `SCRATCH=/private/tmp/claude-501/-Users-reainmaker-Downloads-posture-analysis-claude-kind-galileo-qcm0y1/29186ebd-6c59-4fb8-85b4-474e22203cd0/scratchpad`.
  Prefix every npm/npx command with `export PATH="$SCRATCH/bin:$PATH" &&`.
- After any `npm ci`, run `npx prisma generate` in `services/backend-api` or two suites fail with TS7006.
- Baseline before this plan: backend 15 suites / 77 tests pass; iOS builds and 2 XCTests pass.
- iOS commands (run from `apps/ios-client`):
  - Build: `xcodebuild -scheme PostureAnalysisClient -destination 'generic/platform=iOS Simulator' -derivedDataPath $SCRATCH/ios-dd build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"`
  - Test: `xcodebuild -scheme PostureAnalysisClient -destination 'id=B8FB4DF9-2D69-4E46-AE1B-2B0ABC2311E2' -derivedDataPath $SCRATCH/ios-dd test 2>&1 | grep -E "error:|Test Case .*(passed|failed)|TEST (SUCCEEDED|FAILED)"`
- Backend tests: `cd services/backend-api && npx jest <path>`.

---

### Task 0: Put the repo under git with a baseline commit

**Files:** none changed.

- [ ] **Step 1: Init and inspect what would be committed**

```bash
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1
git init -q && git add -A && git status --short | awk '{print $2}' | cut -d/ -f1-2 | sort | uniq -c | sort -rn | head -30
git status --short | grep -iE "\.env$|secret|credential|\.pem$|\.key$|node_modules" || echo "no suspicious paths"
```
Expected: no `node_modules`, no `.env`. If anything suspicious appears, `git reset` it and add it to `.gitignore` before committing.

- [ ] **Step 2: Baseline commit**

```bash
git commit -q -m "Baseline before piece 1 (session token + consent)" && git log --oneline | head -1
```

---

### Task 1: `SubjectAuthService` — issue and verify tokens

**Files:**
- Create: `services/backend-api/src/auth/subject-auth.service.ts`
- Create: `services/backend-api/src/auth/subject-auth.service.spec.ts`
- Modify: `services/backend-api/src/auth/auth.module.ts` (providers/exports)

- [ ] **Step 1: Write the failing test**

```ts
// services/backend-api/src/auth/subject-auth.service.spec.ts
import { JwtService } from "@nestjs/jwt";
import { SubjectAuthService } from "./subject-auth.service";

const jwt = new JwtService({ secret: "test-secret" });
const service = new SubjectAuthService(jwt);

describe("SubjectAuthService", () => {
  it("issues a 4h subject token scoped to one session", async () => {
    const token = await service.issueSessionToken("s1", "p1");
    const payload = await jwt.verifyAsync(token);
    expect(payload).toMatchObject({ sub: "p1", sessionId: "s1", role: "subject" });
    expect(payload.exp - payload.iat).toBe(4 * 60 * 60);
  });

  it("verify returns null for missing, malformed, or foreign-signed tokens", async () => {
    expect(await service.verify(undefined)).toBeNull();
    expect(await service.verify("not.a.jwt")).toBeNull();
    const foreign = await new JwtService({ secret: "other-secret" }).signAsync({ role: "clinician" });
    expect(await service.verify(foreign)).toBeNull();
  });

  it("verify returns the claims of a valid token", async () => {
    const token = await service.issueSessionToken("s1", "p1");
    expect(await service.verify(token)).toMatchObject({ sessionId: "s1", role: "subject" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/auth/subject-auth.service.spec.ts`
Expected: FAIL — `Cannot find module './subject-auth.service'`.

- [ ] **Step 3: Implement**

```ts
// services/backend-api/src/auth/subject-auth.service.ts
import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { JwtPayload } from "./auth.service";

export const SUBJECT_TOKEN_TTL = "4h";

/** A subject's device token: valid for exactly one session (docs/adr/012). */
export interface SubjectJwtPayload {
  sub: string;
  sessionId: string;
  role: "subject";
}

export type AccessClaims = JwtPayload | SubjectJwtPayload;

@Injectable()
export class SubjectAuthService {
  constructor(private readonly jwt: JwtService) {}

  issueSessionToken(sessionId: string, subjectPseudoId: string): Promise<string> {
    const payload: SubjectJwtPayload = { sub: subjectPseudoId, sessionId, role: "subject" };
    return this.jwt.signAsync(payload, { expiresIn: SUBJECT_TOKEN_TTL });
  }

  /** Never throws - callers that must not reject (symptom reports, gateway) need a verdict, not an exception. */
  async verify(token: string | undefined): Promise<AccessClaims | null> {
    if (!token) return null;
    try {
      return await this.jwt.verifyAsync<AccessClaims>(token);
    } catch {
      return null;
    }
  }
}

export function isSubjectTokenFor(claims: AccessClaims | null, sessionId: string): boolean {
  return claims?.role === "subject" && "sessionId" in claims && claims.sessionId === sessionId;
}
```

In `auth.module.ts` add the import and register it:

```ts
import { SubjectAuthService } from "./subject-auth.service";
// ...
  providers: [AuthService, PrismaService, JwtAuthGuard, RolesGuard, SubjectAuthService],
  exports: [JwtAuthGuard, RolesGuard, SubjectAuthService],
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/auth/subject-auth.service.spec.ts` → 3 passed.

- [ ] **Step 5: Commit**

```bash
git add services/backend-api/src/auth && git commit -q -m "Add SubjectAuthService for session-scoped subject tokens"
```

---

### Task 2: Consent validation and token issue in `POST /sessions`

**Files:**
- Modify: `services/backend-api/src/consent/consent.service.ts` (add `findActive`, reuse in `hasActiveScope`)
- Modify: `services/backend-api/src/sessions/sessions.service.ts`
- Modify: `services/backend-api/src/sessions/sessions.module.ts` (import `ConsentModule`)
- Create: `services/backend-api/src/sessions/sessions.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/backend-api/src/sessions/sessions.service.spec.ts
import { ForbiddenException } from "@nestjs/common";
import { SessionsService } from "./sessions.service";

const retention = (optIn: boolean) => ({
  rawVideo: { optIn, retentionDays: optIn ? 7 : null },
  derivedEvents: { retentionDays: 30 },
});

const input = (overrides: Record<string, unknown> = {}) => ({
  subjectPseudoId: "p1",
  protocolId: "bodyweight-squat",
  protocolVersion: "v0-draft",
  deploymentContext: "clinic_supervised" as const,
  consentRecordId: "c1",
  retentionPolicy: retention(false),
  ...overrides,
});

function build(consent: { subjectPseudoId: string; scopes: string[] } | null) {
  const prisma = {
    session: {
      create: jest.fn().mockResolvedValue(undefined),
      findUniqueOrThrow: jest.fn().mockImplementation(({ where }) => Promise.resolve({ id: where.id, state: "Setup" })),
    },
  };
  const safety = { startSession: jest.fn().mockResolvedValue(undefined) };
  const consentService = { findActive: jest.fn().mockResolvedValue(consent) };
  const subjectAuth = { issueSessionToken: jest.fn().mockResolvedValue("signed.token") };
  const service = new SessionsService(
    prisma as never, safety as never, {} as never, consentService as never, subjectAuth as never
  );
  return { service, prisma, subjectAuth };
}

describe("SessionsService.create", () => {
  it("rejects a missing or revoked consent record", async () => {
    const { service, prisma } = build(null);
    await expect(service.create(input())).rejects.toThrow(ForbiddenException);
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it("rejects a consent record belonging to another subject", async () => {
    const { service } = build({ subjectPseudoId: "p2", scopes: ["derived_events"] });
    await expect(service.create(input())).rejects.toThrow(ForbiddenException);
  });

  it("rejects consent without the derived_events scope", async () => {
    const { service } = build({ subjectPseudoId: "p1", scopes: ["raw_video"] });
    await expect(service.create(input())).rejects.toThrow(ForbiddenException);
  });

  it("rejects raw video opt-in without the raw_video scope", async () => {
    const { service } = build({ subjectPseudoId: "p1", scopes: ["derived_events"] });
    await expect(service.create(input({ retentionPolicy: retention(true) }))).rejects.toThrow(ForbiddenException);
  });

  it("creates the session and returns it with a session-scoped token", async () => {
    const { service, prisma, subjectAuth } = build({ subjectPseudoId: "p1", scopes: ["derived_events"] });
    const result = await service.create(input());
    expect(prisma.session.create).toHaveBeenCalledTimes(1);
    expect(result.session.state).toBe("Setup");
    expect(result.sessionToken).toBe("signed.token");
    expect(subjectAuth.issueSessionToken).toHaveBeenCalledWith(result.session.id, "p1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/sessions/sessions.service.spec.ts`
Expected: FAIL — `create` resolves (no consent check) and `result.session` is undefined.

- [ ] **Step 3: Implement**

In `consent.service.ts`, replace `hasActiveScope` with:

```ts
  /** The record's subject and scopes if it exists and is not revoked, else null. */
  async findActive(consentRecordId: string): Promise<{ subjectPseudoId: string; scopes: string[] } | null> {
    const record = await this.prisma.consentRecord.findUnique({ where: { id: consentRecordId } });
    if (!record || record.revokedAt) return null;
    return { subjectPseudoId: record.subjectPseudoId, scopes: record.scopes as unknown as string[] };
  }

  /** True only when a non-revoked consent record exists for `consentRecordId` with `scope` in its scopes. */
  async hasActiveScope(consentRecordId: string, scope: string): Promise<boolean> {
    const record = await this.findActive(consentRecordId);
    return record ? record.scopes.includes(scope) : false;
  }
```

In `sessions.service.ts`: change imports and constructor, and replace `create`:

```ts
import { ForbiddenException, Injectable } from "@nestjs/common";
import { v4 as uuid } from "uuid";
import { SubjectAuthService } from "../auth/subject-auth.service";
import { ConsentService } from "../consent/consent.service";
import { EventsService } from "../events/events.service";
import { PrismaService } from "../common/prisma.service";
import { SafetyService } from "../safety/safety.service";
```

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyService,
    private readonly events: EventsService,
    private readonly consent: ConsentService,
    private readonly subjectAuth: SubjectAuthService
  ) {}

  async create(input: CreateSessionInput) {
    await this.assertConsentCovers(input);
    const id = uuid();
    await this.prisma.session.create({
      data: {
        id,
        subjectPseudoId: input.subjectPseudoId,
        protocolId: input.protocolId,
        protocolVersion: input.protocolVersion,
        deploymentContext: input.deploymentContext,
        consentRecordId: input.consentRecordId,
        retentionPolicy: input.retentionPolicy as object,
        calibrationRef: input.calibrationRef ?? null,
        state: "Setup",
      },
    });
    // Seeds the actor + persisted snapshot for this session id.
    await this.safety.startSession(id);
    const session = await this.get(id);
    const sessionToken = await this.subjectAuth.issueSessionToken(id, input.subjectPseudoId);
    return { session, sessionToken };
  }

  private async assertConsentCovers(input: CreateSessionInput) {
    const consent = await this.consent.findActive(input.consentRecordId);
    if (!consent || consent.subjectPseudoId !== input.subjectPseudoId) {
      throw new ForbiddenException("No active consent record for this subject.");
    }
    if (!consent.scopes.includes("derived_events")) {
      throw new ForbiddenException("Consent record lacks the 'derived_events' scope required to run a session.");
    }
    const rawVideo = (input.retentionPolicy as { rawVideo?: { optIn?: boolean } } | null)?.rawVideo;
    if (rawVideo?.optIn === true && !consent.scopes.includes("raw_video")) {
      throw new ForbiddenException("Raw video retention requires the 'raw_video' consent scope.");
    }
  }
```

In `sessions.module.ts` add `ConsentModule` to `imports`:

```ts
import { ConsentModule } from "../consent/consent.module";
// ...
  imports: [SafetyModule, EventsModule, MlClientModule, WsModule, AuthModule, ConsentModule],
```

- [ ] **Step 4: Check for other callers of `SessionsService.create`**

Run: `grep -rn "sessions.create(\|sessionsService.create(" services/backend-api/src | grep -v spec`
Expected: only `sessions.controller.ts` (which returns the result unchanged). Fix any other caller to read `.session`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest src/sessions src/consent` → all pass (5 new + 4 existing consent tests).

- [ ] **Step 6: Commit**

```bash
git add services/backend-api/src/consent services/backend-api/src/sessions && git commit -q -m "Validate consent at session creation and return a session token"
```

---

### Task 3: `SessionOwnershipGuard`

**Files:**
- Create: `services/backend-api/src/auth/session-ownership.guard.ts`
- Create: `services/backend-api/src/auth/session-ownership.guard.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/backend-api/src/auth/session-ownership.guard.spec.ts
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { SessionOwnershipGuard } from "./session-ownership.guard";

function context(user: unknown, params: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  return { switchToHttp: () => ({ getRequest: () => ({ user, params, body }) }) } as unknown as ExecutionContext;
}

const subject = (sessionId: string) => ({ sub: "p1", sessionId, role: "subject" });
const guard = new SessionOwnershipGuard();

describe("SessionOwnershipGuard", () => {
  it("allows a subject token for the session in :id", () => {
    expect(guard.canActivate(context(subject("s1"), { id: "s1" }))).toBe(true);
  });

  it("allows a subject token for the session in :sessionId", () => {
    expect(guard.canActivate(context(subject("s1"), { sessionId: "s1" }))).toBe(true);
  });

  it("allows a subject token for the session named in the body", () => {
    expect(guard.canActivate(context(subject("s1"), {}, { sessionId: "s1" }))).toBe(true);
  });

  it("rejects a subject token for a different session", () => {
    expect(() => guard.canActivate(context(subject("s2"), { id: "s1" }))).toThrow(ForbiddenException);
  });

  it("rejects a clinician token on a subject route", () => {
    expect(() => guard.canActivate(context({ sub: "c1", username: "dr", role: "clinician" }, { id: "s1" }))).toThrow(
      ForbiddenException
    );
  });

  it("rejects when the request names no session", () => {
    expect(() => guard.canActivate(context(subject("s1")))).toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/auth/session-ownership.guard.spec.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// services/backend-api/src/auth/session-ownership.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";

/**
 * Apply after JwtAuthGuard: `@UseGuards(JwtAuthGuard, SessionOwnershipGuard)`.
 * Passes only a subject token issued for the session this request targets
 * (route :id, route :sessionId, or body.sessionId) - docs/adr/012.
 */
@Injectable()
export class SessionOwnershipGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: string; sessionId?: string } | undefined;
    const target: unknown = request.params?.id ?? request.params?.sessionId ?? request.body?.sessionId;
    if (user?.role !== "subject" || typeof target !== "string" || user.sessionId !== target) {
      throw new ForbiddenException("Token is not valid for this session.");
    }
    return true;
  }
}
```

- [ ] **Step 4: Run to verify it passes** → 6 passed.

- [ ] **Step 5: Commit**

```bash
git add services/backend-api/src/auth && git commit -q -m "Add SessionOwnershipGuard"
```

---

### Task 4: Guard every subject-facing route

**Files:**
- Create: `services/backend-api/src/auth/subject-route-guards.spec.ts`
- Modify: `services/backend-api/src/sessions/sessions.controller.ts` (5 methods)
- Modify: `services/backend-api/src/ml-integration/frames.controller.ts`
- Modify: `services/backend-api/src/ml-integration/detect-objects.controller.ts`
- Modify: `services/backend-api/src/sensors/sensors.controller.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/backend-api/src/auth/subject-route-guards.spec.ts
import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { DetectObjectsController } from "../ml-integration/detect-objects.controller";
import { FramesController } from "../ml-integration/frames.controller";
import { SensorsController } from "../sensors/sensors.controller";
import { SessionsController } from "../sessions/sessions.controller";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { SessionOwnershipGuard } from "./session-ownership.guard";

// POST /symptom-reports is deliberately absent - see symptoms.controller.ts and docs/adr/012.
// eslint-disable-next-line @typescript-eslint/ban-types
const SUBJECT_ROUTES: Array<[string, Function, string]> = [
  ["POST /sessions/:id/calibrate", SessionsController, "calibrate"],
  ["POST /sessions/:id/setup-unavailable", SessionsController, "setupUnavailable"],
  ["POST /sessions/:id/height", SessionsController, "setHeight"],
  ["POST /sessions/:id/scale-calibration", SessionsController, "calibrateScaleFromFrame"],
  ["POST /sessions/:id/camera-poses", SessionsController, "submitCameraPose"],
  ["POST /sessions/:sessionId/frames", FramesController, "submit"],
  ["POST /sessions/:sessionId/detect-objects", DetectObjectsController, "submit"],
  ["POST /sensor-readings", SensorsController, "submit"],
];

describe("subject-facing routes", () => {
  it.each(SUBJECT_ROUTES)("%s requires a subject token for the same session", (_name, controller, method) => {
    const handler = (controller.prototype as Record<string, object>)[method];
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
    expect(guards).toEqual([JwtAuthGuard, SessionOwnershipGuard]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → 8 failures (`guards` is `[]`).

- [ ] **Step 3: Add the guards**

In each file add the imports (adjust relative paths — all four files live one level below `src/`):

```ts
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SessionOwnershipGuard } from "../auth/session-ownership.guard";
```

and `UseGuards` to the `@nestjs/common` import where missing. Then put this line directly above each listed method's `@Post(...)` decorator:

```ts
  @UseGuards(JwtAuthGuard, SessionOwnershipGuard)
```

Methods: `SessionsController.calibrate`, `.setupUnavailable`, `.setHeight`, `.calibrateScaleFromFrame`, `.submitCameraPose`; `FramesController.submit`; `DetectObjectsController.submit`; `SensorsController.submit`. `sessions.controller.ts` already imports `JwtAuthGuard` and `UseGuards` — add only `SessionOwnershipGuard` there.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/auth/subject-route-guards.spec.ts` → 8 passed. Then `npx jest` → all suites pass.

- [ ] **Step 5: Commit**

```bash
git add services/backend-api/src && git commit -q -m "Require a session token on subject-facing routes"
```

---

### Task 5: Symptom reports stay fail-safe

**Files:**
- Modify: `services/backend-api/src/symptoms/symptoms.controller.ts`
- Create: `services/backend-api/src/symptoms/symptoms.controller.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/backend-api/src/symptoms/symptoms.controller.spec.ts
import { SymptomsController } from "./symptoms.controller";

function build(claims: unknown) {
  const events = { appendValidated: jest.fn().mockResolvedValue(undefined) };
  const safety = { reportSymptom: jest.fn().mockResolvedValue("Pause") };
  const gateway = { broadcast: jest.fn() };
  const subjectAuth = { verify: jest.fn().mockResolvedValue(claims) };
  const controller = new SymptomsController(events as never, safety as never, gateway as never, subjectAuth as never);
  const warn = jest.spyOn((controller as unknown as { logger: { warn: () => void } }).logger, "warn").mockImplementation();
  return { controller, safety, warn };
}

const body = { sessionId: "s1", symptoms: ["dizziness"], severity: "moderate" as const };

describe("SymptomsController.report", () => {
  it("pauses the session even with no token, and logs it", async () => {
    const { controller, safety, warn } = build(null);
    await expect(controller.report(body, undefined)).resolves.toMatchObject({ state: "Pause" });
    expect(safety.reportSymptom).toHaveBeenCalledWith("s1", expect.any(String), "pause");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("pauses the session with a token for another session, and logs it", async () => {
    const { controller, safety, warn } = build({ role: "subject", sessionId: "s2", sub: "p1" });
    await expect(controller.report(body, "Bearer t")).resolves.toMatchObject({ state: "Pause" });
    expect(safety.reportSymptom).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not log a report carrying this session's token", async () => {
    const { controller, warn } = build({ role: "subject", sessionId: "s1", sub: "p1" });
    await controller.report(body, "Bearer t");
    expect(warn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL (constructor takes 3 args; no `logger`).

- [ ] **Step 3: Implement**

Update imports and the class:

```ts
import { Body, Controller, Headers, Logger, Post } from "@nestjs/common";
import { v4 as uuid } from "uuid";
import { isSubjectTokenFor, SubjectAuthService } from "../auth/subject-auth.service";
import { EventsService } from "../events/events.service";
import { SafetyService } from "../safety/safety.service";
import { SessionGateway } from "../ws/session.gateway";
```

```ts
@Controller("symptom-reports")
export class SymptomsController {
  private readonly logger = new Logger(SymptomsController.name);

  constructor(
    private readonly events: EventsService,
    private readonly safety: SafetyService,
    private readonly gateway: SessionGateway,
    private readonly subjectAuth: SubjectAuthService
  ) {}

  /**
   * Never rejected for missing/invalid auth: a forged report can only pause a
   * session (the safe direction), while rejecting a real one would leave a
   * subject who feels unwell in an active session (CLAUDE.md rule 2,
   * docs/adr/012). Auth status is checked after the pause and only logged.
   */
  @Post()
  async report(@Body() body: SymptomReportBody, @Headers("authorization") authorization?: string) {
```

Keep the existing body of `report` unchanged, and insert this line just before its final `return { symptomReportId, state };`:

```ts
    await this.logIfUnauthenticated(body.sessionId, authorization);
```

Add the private method at the end of the class:

```ts
  private async logIfUnauthenticated(sessionId: string, authorization: string | undefined) {
    const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
    if (!isSubjectTokenFor(await this.subjectAuth.verify(token), sessionId)) {
      this.logger.warn(`session ${sessionId}: symptom report accepted without a valid session token`);
    }
  }
```

- [ ] **Step 4: Run to verify it passes** → 3 passed; `npx jest` → all pass.

- [ ] **Step 5: Commit**

```bash
git add services/backend-api/src/symptoms && git commit -q -m "Keep symptom reports fail-safe; log unauthenticated ones"
```

---

### Task 6: Authenticate Socket.IO connections

**Files:**
- Modify: `services/backend-api/src/ws/session.gateway.ts`
- Create: `services/backend-api/src/ws/session.gateway.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/backend-api/src/ws/session.gateway.spec.ts
import { SessionGateway } from "./session.gateway";

function client(query: Record<string, unknown>, auth: Record<string, unknown> = {}) {
  return { id: "c", handshake: { query, auth }, join: jest.fn(), disconnect: jest.fn() };
}

function gateway(claims: unknown) {
  const subjectAuth = { verify: jest.fn().mockResolvedValue(claims) };
  return new SessionGateway(subjectAuth as never);
}

describe("SessionGateway.handleConnection", () => {
  it("joins a subject whose token is for the requested session", async () => {
    const c = client({ sessionId: "s1" }, { token: "t" });
    await gateway({ role: "subject", sessionId: "s1", sub: "p1" }).handleConnection(c as never);
    expect(c.join).toHaveBeenCalledWith("session:s1");
    expect(c.disconnect).not.toHaveBeenCalled();
  });

  it("joins a clinician for any session", async () => {
    const c = client({ sessionId: "s1" }, { token: "t" });
    await gateway({ role: "clinician", sub: "c1", username: "dr" }).handleConnection(c as never);
    expect(c.join).toHaveBeenCalledWith("session:s1");
  });

  it("disconnects a subject token for another session", async () => {
    const c = client({ sessionId: "s1" }, { token: "t" });
    await gateway({ role: "subject", sessionId: "s2", sub: "p1" }).handleConnection(c as never);
    expect(c.join).not.toHaveBeenCalled();
    expect(c.disconnect).toHaveBeenCalledWith(true);
  });

  it("disconnects a connection with no valid token", async () => {
    const c = client({ sessionId: "s1" });
    await gateway(null).handleConnection(c as never);
    expect(c.disconnect).toHaveBeenCalledWith(true);
  });

  it("disconnects a connection with no sessionId", async () => {
    const c = client({}, { token: "t" });
    await gateway({ role: "clinician", sub: "c1", username: "dr" }).handleConnection(c as never);
    expect(c.disconnect).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL (constructor has no args; joins without a token).

- [ ] **Step 3: Implement** — replace the class body's constructor/`handleConnection`:

```ts
import { isSubjectTokenFor, SubjectAuthService } from "../auth/subject-auth.service";
```

```ts
  constructor(private readonly subjectAuth: SubjectAuthService) {}

  /**
   * Shared by the subject's device and the clinician dashboard: accepts a
   * subject token for this session, or any clinician token (docs/adr/012).
   */
  async handleConnection(client: Socket) {
    const sessionId = client.handshake.query.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      this.logger.warn(`client ${client.id} connected without a sessionId query param - disconnecting`);
      client.disconnect(true);
      return;
    }
    const claims = await this.subjectAuth.verify(client.handshake.auth?.token);
    if (claims?.role !== "clinician" && !isSubjectTokenFor(claims, sessionId)) {
      this.logger.warn(`client ${client.id} has no valid token for session ${sessionId} - disconnecting`);
      client.disconnect(true);
      return;
    }
    client.join(roomFor(sessionId));
    this.logger.log(`client ${client.id} joined session ${sessionId} as ${claims?.role}`);
  }
```

Also update the class doc comment's first line to: `Push channel for the subject's device and the clinician dashboard: ...`.

- [ ] **Step 4: Run to verify it passes** → 5 passed; `npx jest` → all pass.

- [ ] **Step 5: Commit**

```bash
git add services/backend-api/src/ws && git commit -q -m "Authenticate Socket.IO session connections"
```

---

### Task 7: clinician-web sends its token on the socket

**Files:**
- Modify: `apps/clinician-web/src/api/socket.ts`

- [ ] **Step 1: Implement**

```ts
import { io, type Socket } from "socket.io-client";
import { getToken } from "../auth/tokenStore";
import { BACKEND_API_URL } from "./config";

/**
 * Joins the same per-session Socket.IO room iOS clients use
 * (services/backend-api/src/ws/session.gateway.ts) to get live event
 * broadcasts without polling. Authenticates with the clinician's JWT - the
 * gateway disconnects unauthenticated clients (docs/adr/012). The caller is
 * responsible for calling `disconnect()` on unmount.
 */
export function connectToSession(sessionId: string): Socket {
  return io(BACKEND_API_URL, {
    query: { sessionId },
    auth: { token: getToken() },
    transports: ["websocket"],
  });
}
```

- [ ] **Step 2: Verify it builds and existing tests pass**

Run: `npm run web:build 2>&1 | tail -5 && npm run web:test 2>&1 | tail -5`
Expected: build succeeds; vitest passes.

- [ ] **Step 3: Commit**

```bash
git add apps/clinician-web/src/api/socket.ts && git commit -q -m "Send clinician token on Socket.IO connect"
```

---

### Task 8: iOS — Socket.IO client

**Files:**
- Modify: `apps/ios-client/Package.swift`
- Modify: `apps/ios-client/Sources/Networking/BackendConfig.swift` (drop unused `webSocketURL`)
- Create: `apps/ios-client/Sources/Networking/SessionCredentials.swift`
- Rewrite: `apps/ios-client/Sources/Networking/SessionWebSocketClient.swift`

- [ ] **Step 1: Add the dependency**

```swift
// swift-tools-version:5.9
import PackageDescription

// This package organizes the app's source for Xcode ("Open Package.swift" or
// add as a local package dependency to an App project target) - it cannot be
// built standalone via `swift build` because it depends on iOS-only
// frameworks (SwiftUI, AVFoundation, UIKit). See README.md.
let package = Package(
    name: "PostureAnalysisClient",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "PostureAnalysisClient", targets: ["PostureAnalysisClient"])
    ],
    dependencies: [
        .package(url: "https://github.com/socketio/socket.io-client-swift", from: "16.1.1"),
    ],
    targets: [
        .target(
            name: "PostureAnalysisClient",
            dependencies: [.product(name: "SocketIO", package: "socket.io-client-swift")],
            path: "Sources"
        ),
        .testTarget(name: "PostureAnalysisClientTests", dependencies: ["PostureAnalysisClient"], path: "Tests"),
    ]
)
```

- [ ] **Step 2: Credentials type and request helper**

```swift
// apps/ios-client/Sources/Networking/SessionCredentials.swift
import Foundation

/// The session a device is working in and the session-scoped token
/// POST /sessions returned for it (docs/adr/012).
struct SessionCredentials: Equatable {
    let sessionId: String
    let token: String
}

extension URLRequest {
    mutating func authorize(with token: String?) {
        guard let token else { return }
        setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
    }
}
```

`BackendConfig.swift`:

```swift
import Foundation

/// Where the backend-api lives. In this phase there is no service discovery -
/// point this at your dev machine's IP when running on a physical device
/// (localhost only works in the simulator). REST and Socket.IO share it.
struct BackendConfig {
    static let baseURL = URL(string: "http://localhost:3000")!
}
```

- [ ] **Step 3: Rewrite the socket client**

```swift
// apps/ios-client/Sources/Networking/SessionWebSocketClient.swift
import Foundation
import SocketIO

/// Receives state/quality/decision pushes from backend-api's Socket.IO
/// SessionGateway (services/backend-api/src/ws/session.gateway.ts). Joins the
/// session's room with `?sessionId=` and authenticates with the session token;
/// the gateway disconnects any other client (docs/adr/012).
final class SessionWebSocketClient {
    private let manager: SocketManager
    private let socket: SocketIOClient
    private let token: String
    private let decoder = JSONDecoder()

    var onStateChange: ((SafetyState) -> Void)?
    var onQualityGateFlag: ((QualityGateFlag) -> Void)?
    var onDecisionEvent: ((DecisionEvent) -> Void)?
    var onPoseLandmarkFrame: ((PoseLandmarkFrame) -> Void)?

    init(credentials: SessionCredentials) {
        token = credentials.token
        manager = SocketManager(
            socketURL: BackendConfig.baseURL,
            config: [.log(false), .forceWebsockets(true), .connectParams(["sessionId": credentials.sessionId])]
        )
        socket = manager.defaultSocket
    }

    func connect() {
        socket.on("state") { [weak self] data, _ in
            struct StatePayload: Decodable { let state: SafetyState }
            if let payload: StatePayload = self?.decode(data) { self?.onStateChange?(payload.state) }
        }
        socket.on("quality-gate-flag") { [weak self] data, _ in
            if let flag: QualityGateFlag = self?.decode(data) { self?.onQualityGateFlag?(flag) }
        }
        socket.on("decision-event") { [weak self] data, _ in
            if let event: DecisionEvent = self?.decode(data) { self?.onDecisionEvent?(event) }
        }
        socket.on("pose-landmark-frame") { [weak self] data, _ in
            if let frame: PoseLandmarkFrame = self?.decode(data) { self?.onPoseLandmarkFrame?(frame) }
        }
        socket.connect(withPayload: ["token": token])
    }

    func disconnect() {
        socket.disconnect()
    }

    /// Socket.IO hands each event's payload over as a JSON-compatible object in data[0].
    private func decode<T: Decodable>(_ data: [Any]) -> T? {
        guard
            let object = data.first,
            JSONSerialization.isValidJSONObject(object),
            let json = try? JSONSerialization.data(withJSONObject: object)
        else { return nil }
        return try? decoder.decode(T.self, from: json)
    }
}
```

- [ ] **Step 4: Build** — expected to FAIL only in `SessionViewModel.swift` (`SessionWebSocketClient(sessionId:)`). That call site is fixed in Task 10; do not commit yet.

---

### Task 9: iOS — pseudonymous id, consent client and screen

**Files:**
- Create: `apps/ios-client/Sources/Identity/SubjectIdentityStore.swift`
- Create: `apps/ios-client/Sources/Consent/ConsentScope.swift`
- Create: `apps/ios-client/Sources/Consent/ConsentClient.swift`
- Create: `apps/ios-client/Sources/Consent/ConsentView.swift`
- Create: `apps/ios-client/Tests/SubjectIdentityStoreTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
// apps/ios-client/Tests/SubjectIdentityStoreTests.swift
import XCTest
@testable import PostureAnalysisClient

private final class InMemorySecretStore: SecretStore {
    var values: [String: String] = [:]
    func read(_ key: String) -> String? { values[key] }
    func write(_ key: String, value: String) -> Bool { values[key] = value; return true }
    func delete(_ key: String) { values[key] = nil }
}

final class SubjectIdentityStoreTests: XCTestCase {
    func testPseudoIdIsARandomUUIDAndStable() {
        let backing = InMemorySecretStore()
        let store = SubjectIdentityStore(store: backing)
        let first = store.subjectPseudoId()
        XCTAssertNotNil(UUID(uuidString: first))
        XCTAssertEqual(store.subjectPseudoId(), first)
        XCTAssertEqual(SubjectIdentityStore(store: backing).subjectPseudoId(), first)
    }

    func testConsentRecordIdRoundTripsAndClears() {
        let store = SubjectIdentityStore(store: InMemorySecretStore())
        XCTAssertNil(store.consentRecordId)
        store.saveConsentRecordId("c1")
        XCTAssertEqual(store.consentRecordId, "c1")
        store.clearConsentRecordId()
        XCTAssertNil(store.consentRecordId)
    }

    func testRequiredScopeIsOnlyDerivedEvents() {
        XCTAssertEqual(ConsentScope.allCases.filter(\.isRequired), [.derivedEvents])
        XCTAssertEqual(
            Set(ConsentScope.allCases.map(\.rawValue)),
            ["derived_events", "raw_video", "research_data_export", "wearable_integration"]
        )
    }
}
```

- [ ] **Step 2: Implement the store**

```swift
// apps/ios-client/Sources/Identity/SubjectIdentityStore.swift
import Foundation
import Security

protocol SecretStore {
    func read(_ key: String) -> String?
    func write(_ key: String, value: String) -> Bool
    func delete(_ key: String)
}

struct KeychainSecretStore: SecretStore {
    private let service = "com.beaive.subject"

    private func baseQuery(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
    }

    func read(_ key: String) -> String? {
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func write(_ key: String, value: String) -> Bool {
        delete(key)
        var query = baseQuery(key)
        query[kSecValueData as String] = Data(value.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    func delete(_ key: String) {
        SecItemDelete(baseQuery(key) as CFDictionary)
    }
}

/// The device's pseudonymous subject id - a random UUID, never derived from a
/// name, email or other identifier (docs/consent-and-retention.md) - and the
/// consent record granted for it.
final class SubjectIdentityStore {
    private static let pseudoIdKey = "subjectPseudoId"
    private static let consentRecordIdKey = "consentRecordId"
    private let store: SecretStore

    init(store: SecretStore = KeychainSecretStore()) {
        self.store = store
    }

    func subjectPseudoId() -> String {
        if let existing = store.read(Self.pseudoIdKey) { return existing }
        let id = UUID().uuidString.lowercased()
        _ = store.write(Self.pseudoIdKey, value: id)
        return id
    }

    var consentRecordId: String? { store.read(Self.consentRecordIdKey) }

    func saveConsentRecordId(_ id: String) {
        _ = store.write(Self.consentRecordIdKey, value: id)
    }

    func clearConsentRecordId() {
        store.delete(Self.consentRecordIdKey)
    }
}
```

- [ ] **Step 3: Consent scope, client and view**

```swift
// apps/ios-client/Sources/Consent/ConsentScope.swift
import Foundation

/// Mirrors consent-record.schema.json's scope enum.
enum ConsentScope: String, CaseIterable, Identifiable {
    case derivedEvents = "derived_events"
    case rawVideo = "raw_video"
    case researchDataExport = "research_data_export"
    case wearableIntegration = "wearable_integration"

    var id: String { rawValue }

    /// Sessions cannot run without derived-event retention (backend enforces this).
    var isRequired: Bool { self == .derivedEvents }

    var title: String {
        switch self {
        case .derivedEvents: return "Session measurements"
        case .rawVideo: return "Keep session video"
        case .researchDataExport: return "Research use"
        case .wearableIntegration: return "Connected sensors"
        }
    }

    var detail: String {
        switch self {
        case .derivedEvents:
            return "Store estimated joint angles, movement and data-quality results from your sessions - never video - so your clinician can review them. Required to run a session."
        case .rawVideo:
            return "Store the camera video of your sessions for a limited time. Off unless you choose it."
        case .researchDataExport:
            return "Include de-identified session measurements in research studies."
        case .wearableIntegration:
            return "Combine readings from a connected wearable, such as heart rate, with your sessions."
        }
    }
}
```

```swift
// apps/ios-client/Sources/Consent/ConsentClient.swift
import Foundation

/// POST /consent-records (services/backend-api/src/consent/consent.controller.ts).
final class ConsentClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    struct CreateConsentInput: Encodable {
        let subjectPseudoId: String
        let scopes: [String]
    }

    struct ConsentRecord: Decodable {
        let id: String
    }

    func create(_ input: CreateConsentInput) async throws -> ConsentRecord {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("consent-records"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(input)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ConsentClientError.serverError((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        return try JSONDecoder().decode(ConsentRecord.self, from: data)
    }
}

enum ConsentClientError: Error {
    case serverError(Int)
}
```

```swift
// apps/ios-client/Sources/Consent/ConsentView.swift
import SwiftUI

/// First-run consent (docs/consent-and-retention.md). `derived_events` is
/// required and locked on; every other scope is off unless chosen.
struct ConsentView: View {
    let subjectPseudoId: String
    let onConsented: (_ consentRecordId: String) -> Void

    @State private var selected: Set<ConsentScope> = [.derivedEvents]
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private let client = ConsentClient()

    var body: some View {
        Form {
            Section {
                Text("Choose what beAIve may store from your sessions. You can ask your clinician to withdraw consent at any time.")
                    .font(.callout)
            }
            Section("Your choices") {
                ForEach(ConsentScope.allCases) { scope in
                    Toggle(isOn: binding(for: scope)) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(scope.title)
                            Text(scope.detail).font(.caption).foregroundColor(.secondary)
                        }
                    }
                    .disabled(scope.isRequired)
                }
            }
            if let errorMessage {
                Section { Text(errorMessage).foregroundColor(.red) }
            }
            Section {
                Button {
                    submit()
                } label: {
                    if isSubmitting {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text("I agree").frame(maxWidth: .infinity)
                    }
                }
                .disabled(isSubmitting)
            }
        }
    }

    private func binding(for scope: ConsentScope) -> Binding<Bool> {
        Binding(
            get: { selected.contains(scope) },
            set: { isOn in
                if isOn { selected.insert(scope) } else if !scope.isRequired { selected.remove(scope) }
            }
        )
    }

    private func submit() {
        isSubmitting = true
        errorMessage = nil
        Task {
            defer { isSubmitting = false }
            do {
                let record = try await client.create(
                    .init(subjectPseudoId: subjectPseudoId, scopes: selected.map(\.rawValue).sorted())
                )
                onConsented(record.id)
            } catch {
                errorMessage = "Could not save your choices. Check your connection and try again."
            }
        }
    }
}
```

- [ ] **Step 4: Tests run after Task 10** (the package does not compile until the view model is updated).

---

### Task 10: iOS — send the token everywhere and remove placeholders

**Files:**
- Modify: `apps/ios-client/Sources/Networking/SessionsClient.swift`
- Modify: `apps/ios-client/Sources/Networking/FrameStreamingClient.swift`
- Modify: `apps/ios-client/Sources/Networking/CameraPoseStreamingClient.swift`
- Modify: `apps/ios-client/Sources/Safety/SymptomReportingClient.swift`
- Modify: `apps/ios-client/Sources/Safety/SymptomStopButton.swift`
- Modify: `apps/ios-client/Sources/Session/SessionViewModel.swift`
- Modify: `apps/ios-client/Sources/Session/CalibrationFlowView.swift`
- Modify: `apps/ios-client/Sources/Session/HeightEntryView.swift`
- Modify: `apps/ios-client/Sources/App/RootView.swift`
- Create: `apps/ios-client/Tests/SessionAuthTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
// apps/ios-client/Tests/SessionAuthTests.swift
import XCTest
@testable import PostureAnalysisClient

final class SessionAuthTests: XCTestCase {
    func testAuthorizeSetsBearerHeader() {
        var request = URLRequest(url: URL(string: "http://localhost/x")!)
        request.authorize(with: "abc")
        XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer abc")
    }

    func testAuthorizeWithNilLeavesRequestUnchanged() {
        var request = URLRequest(url: URL(string: "http://localhost/x")!)
        request.authorize(with: nil)
        XCTAssertNil(request.value(forHTTPHeaderField: "authorization"))
    }

    func testDecodesCreateSessionResponse() throws {
        let json = #"{"session":{"id":"s1","state":"Setup","subjectPseudoId":"p1"},"sessionToken":"t"}"#
        let response = try JSONDecoder().decode(SessionsClient.CreateSessionResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.session.id, "s1")
        XCTAssertEqual(response.sessionToken, "t")
        XCTAssertEqual(response.credentials, SessionCredentials(sessionId: "s1", token: "t"))
    }
}
```

- [ ] **Step 2: `SessionsClient`** — replace `SessionRecord`/`create`/`calibrate`/`setHeight`/`submitScaleCalibrationFrame`:

```swift
    struct SessionRecord: Decodable {
        let id: String
        let state: SafetyState
    }

    struct CreateSessionResponse: Decodable {
        let session: SessionRecord
        let sessionToken: String
        var credentials: SessionCredentials { SessionCredentials(sessionId: session.id, token: sessionToken) }
    }

    /// Throws `.consentRejected` on 403 - the stored consent record is missing,
    /// revoked, or lacks a required scope, so the caller must ask again.
    func create(_ input: CreateSessionInput) async throws -> CreateSessionResponse {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("sessions"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(input)

        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        if status == 403 { throw SessionsClientError.consentRejected }
        guard (200..<300).contains(status) else { throw SessionsClientError.serverError(status) }
        return try JSONDecoder().decode(CreateSessionResponse.self, from: data)
    }

    /// Setup -> Observing, once the calibration flow confirms the camera view
    /// and consent are in place (services/backend-api/src/sessions/sessions.controller.ts).
    func calibrate(credentials: SessionCredentials) async throws -> SafetyState {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("sessions/\(credentials.sessionId)/calibrate"))
        request.httpMethod = "POST"
        request.authorize(with: credentials.token)
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(status) else { throw SessionsClientError.serverError(status) }
        struct Result: Decodable { let state: SafetyState }
        return try JSONDecoder().decode(Result.self, from: data).state
    }

    /// Feeds subject-specific scale calibration (docs/adr/008) - call before submitScaleCalibrationFrame.
    func setHeight(credentials: SessionCredentials, subjectHeightMeters: Double) async throws {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("sessions/\(credentials.sessionId)/height"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.authorize(with: credentials.token)
        request.httpBody = try JSONEncoder().encode(["subjectHeightMeters": subjectHeightMeters])
        let (_, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(status) else { throw SessionsClientError.serverError(status) }
    }

    /// Runs subject-specific scale calibration against a single frame. Throws
    /// on 422 (ankle/nose not fully observed) - the caller should ask the
    /// user to reposition and retry, never treat this as success.
    func submitScaleCalibrationFrame(credentials: SessionCredentials, frameId: String, imageData: Data) async throws {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("sessions/\(credentials.sessionId)/scale-calibration"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.authorize(with: credentials.token)
        request.httpBody = try JSONEncoder().encode([
            "frameId": frameId,
            "imageBase64": imageData.base64EncodedString(),
        ])
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ScaleCalibrationError.notObserved((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
    }
```

Add after `ScaleCalibrationError`:

```swift
enum SessionsClientError: Error {
    case consentRejected
    case serverError(Int)
}
```

- [ ] **Step 3: Streaming and symptom clients**

`FrameStreamingClient.submitFrame` — change the signature and URL, and authorize:

```swift
    func submitFrame(
        credentials: SessionCredentials,
        frameId: String,
        capturedAt: Date,
        imageData: Data
    ) async throws -> SubmitFrameResult {
        var request = URLRequest(
            url: BackendConfig.baseURL.appendingPathComponent("sessions/\(credentials.sessionId)/frames")
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.authorize(with: credentials.token)
```
(rest of the method unchanged).

`CameraPoseStreamingClient.submit`:

```swift
    func submit(credentials: SessionCredentials, pose: CameraPose) async throws {
        var request = URLRequest(
            url: BackendConfig.baseURL.appendingPathComponent("sessions/\(credentials.sessionId)/camera-poses")
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.authorize(with: credentials.token)
```
(rest unchanged).

`SymptomReportingClient` — add an optional token to the input and send it when present (the backend never rejects a report for auth):

```swift
    struct SymptomReportInput {
        let sessionId: String
        /// Sent when available; the report is accepted without it (docs/adr/012).
        let token: String?
        let symptoms: [String]
        let severity: String // "mild" | "moderate" | "severe"
        let freeText: String?
    }
```

and in `send(_:)` after the content-type line:

```swift
        request.authorize(with: input.token)
```

`SymptomStopButton` — replace `let sessionId: String` with `let credentials: SessionCredentials` and the report call with:

```swift
                _ = try await client.report(
                    .init(
                        sessionId: credentials.sessionId,
                        token: credentials.token,
                        symptoms: symptoms,
                        severity: severity,
                        freeText: nil
                    )
                )
```

- [ ] **Step 4: View model, calibration and height views**

`SessionViewModel`: replace `let sessionId: String` and `init` with:

```swift
    let credentials: SessionCredentials
    var sessionId: String { credentials.sessionId }
```

```swift
    init(credentials: SessionCredentials) {
        self.credentials = credentials
    }
```

and update three call sites:

```swift
        let socket = SessionWebSocketClient(credentials: credentials)
```
```swift
                    try await self.poseStreamer.submit(credentials: self.credentials, pose: pose)
```
```swift
                _ = try await uploader.submitFrame(
                    credentials: credentials,
                    frameId: frameId,
                    capturedAt: Date(),
                    imageData: jpegData
                )
```

`CalibrationFlowView`: replace `let sessionId: String` with `let credentials: SessionCredentials` and the call with `_ = try await client.calibrate(credentials: credentials)`.

`HeightEntryView`: replace `let sessionId: String` with `let credentials: SessionCredentials` and the call with `try await client.setHeight(credentials: credentials, subjectHeightMeters: centimeters / 100.0)`.

- [ ] **Step 5: `RootView` — consent first, real ids, credentials through the flow**

```swift
import SwiftUI

/// Consent -> pick a draft protocol -> calibrate -> live session. The subject
/// id is the device's pseudonymous UUID and the consent record is the one the
/// subject granted in ConsentView (docs/adr/012).
struct RootView: View {
    private enum Step {
        case consent
        case selectProtocol
        case calibrate(SessionCredentials)
        case live(SessionCredentials)
    }

    @State private var step: Step
    @State private var errorMessage: String?
    private let identity: SubjectIdentityStore
    private let sessionsClient = SessionsClient()

    init(identity: SubjectIdentityStore = SubjectIdentityStore()) {
        self.identity = identity
        _step = State(initialValue: identity.consentRecordId == nil ? .consent : .selectProtocol)
    }

    var body: some View {
        switch step {
        case .consent:
            ConsentView(subjectPseudoId: identity.subjectPseudoId()) { consentRecordId in
                identity.saveConsentRecordId(consentRecordId)
                step = .selectProtocol
            }
        case .selectProtocol:
            VStack {
                if let errorMessage {
                    Text(errorMessage).foregroundColor(.red).padding(.horizontal)
                }
                ProtocolSelectionView { proto in
                    createSession(for: proto)
                }
            }
        case .calibrate(let credentials):
            CalibrationFlowView(credentials: credentials) {
                step = .live(credentials)
            }
        case .live(let credentials):
            LiveSessionView(credentials: credentials)
        }
    }

    private func createSession(for proto: ProtocolSummary) {
        guard let consentRecordId = identity.consentRecordId else {
            step = .consent
            return
        }
        errorMessage = nil
        Task {
            do {
                let response = try await sessionsClient.create(
                    .init(
                        subjectPseudoId: identity.subjectPseudoId(),
                        protocolId: proto.protocolKey,
                        protocolVersion: proto.version,
                        deploymentContext: "clinic_supervised",
                        consentRecordId: consentRecordId,
                        retentionPolicy: .init(
                            rawVideo: .init(optIn: false, retentionDays: nil),
                            derivedEvents: .init(retentionDays: 30)
                        )
                    )
                )
                step = .calibrate(response.credentials)
            } catch SessionsClientError.consentRejected {
                identity.clearConsentRecordId()
                step = .consent
            } catch {
                errorMessage = "Could not start a session. Check your connection and try again."
            }
        }
    }
}

private struct LiveSessionView: View {
    @StateObject private var viewModel: SessionViewModel

    init(credentials: SessionCredentials) {
        _viewModel = StateObject(wrappedValue: SessionViewModel(credentials: credentials))
    }

    var body: some View {
        ZStack {
            PoseOverlayView(frame: viewModel.latestFrame, qualityGateFlag: viewModel.latestQualityGateFlag)

            VStack {
                Spacer()
                SymptomStopButton(credentials: viewModel.credentials) {
                    viewModel.haltLocally()
                }
                .padding()
            }
        }
        .task {
            try? viewModel.start()
        }
        .onDisappear {
            viewModel.stop()
        }
    }
}
```

- [ ] **Step 6: Build and test**

Run the iOS build then test commands from "Environment notes".
Expected: `BUILD SUCCEEDED`; 8 tests pass (2 existing + 3 identity + 3 auth).

- [ ] **Step 7: Check no placeholder remains**

Run: `grep -rn "dev-placeholder" apps/ios-client` → no output.

- [ ] **Step 8: Commit**

```bash
git add apps/ios-client && git commit -q -m "iOS: pseudonymous id, consent screen, session token on REST and Socket.IO"
```

---

### Task 11: Document the decision

**Files:**
- Create: `docs/adr/012-subject-session-tokens.md`
- Modify: `docs/adr/010-clinician-authentication.md` ("Still open" first bullet)
- Modify: `README.md` ("What is deliberately not here yet" first sentence)
- Modify: `apps/ios-client/README.md` ("Known gaps")

- [ ] **Step 1: Write ADR-012**

```markdown
# ADR-012: Session-scoped subject tokens

## Status
Accepted (resolves the first "Still open" item of ADR-010)

## Context
ADR-010 secured the clinician REST surface but left every device/subject-facing
route and the Socket.IO gateway open, pending a subject identity design. The iOS
client also sent hardcoded `subjectPseudoId`/`consentRecordId` placeholders, and
`POST /sessions` never checked the consent record it was given.

## Decision
- No subject accounts. The device generates a random UUID as its
  `subjectPseudoId` (Keychain, this device only) - never derived from identity.
- The subject grants consent in-app (`POST /consent-records`, all four scopes
  offered, `derived_events` required).
- `POST /sessions` requires an active consent record belonging to the same
  `subjectPseudoId` with `derived_events` (and `raw_video` if raw-video
  retention is requested), then returns `{ session, sessionToken }`: a JWT
  `{ sub: subjectPseudoId, sessionId, role: "subject" }` valid for 4 h, signed
  with the same `JWT_SECRET` as clinician tokens.
- `JwtAuthGuard` + `SessionOwnershipGuard` protect every subject-facing route;
  the token must name the session the request targets.
- `SessionGateway` admits a subject token for the requested session or any
  clinician token; clinician-web now sends its JWT on connect.
- **Exception: `POST /symptom-reports` never rejects for auth.** A forged report
  can only pause a session - the safe direction - while rejecting a genuine one
  would leave an unwell subject in an active session (CLAUDE.md rule 2).
  Reports without a valid token for their session are accepted and logged.

## Consequences / still open
- No refresh: a session longer than 4 h loses REST/Socket.IO access (symptom
  reports still work). Revisit when real session lengths are known.
- No revocation list (same as clinician tokens).
- `GET /consent-records/:id` remains unauthenticated.
- Patient access to reports released after the session ends needs a longer-lived
  credential - designed in piece 5 of docs/superpowers/specs/2026-10-01-posture-report-design.md.
- `raw_video` consent is recorded but the app still sends `rawVideo.optIn: false`;
  no raw-video storage exists yet.
```

- [ ] **Step 2: Update ADR-010, README and iOS README**

ADR-010 "Still open" first bullet becomes:
`- ~~Gate the Socket.IO gateway~~ - done in ADR-012 (session-scoped subject tokens).`

Root `README.md`, replace the paragraph's opening clause
`Authentication on the WebSocket gateway and every device/subject-facing REST route (\`docs/adr/010-clinician-authentication.md\`'s named scope limit);`
with
`Token refresh and revocation for subject session tokens (\`docs/adr/012-subject-session-tokens.md\`);`.

`apps/ios-client/README.md`: delete the `SessionWebSocketClient` bullet and the `subjectPseudoId`/`consentRecordId` placeholder bullet from "Known gaps", and change "has not been compiled or run" in "Build/run requirements" to "builds and its unit tests pass on Xcode 26 (iOS Simulator); it has not yet been run on a device".

- [ ] **Step 3: Lint and commit**

```bash
npm run lint:claims && git add docs README.md apps/ios-client/README.md && git commit -q -m "ADR-012: session-scoped subject tokens"
```

---

### Task 12: Full verification

- [ ] **Step 1: All suites**

```bash
cd services/backend-api && npx jest 2>&1 | grep -E "^Tests:|^Test Suites:"; cd ../..
npm run web:build 2>&1 | tail -2 && npm run web:test 2>&1 | tail -3
npm run lint:claims
```
Expected: backend 21 suites pass (15 + 6 new), web build + tests pass, lint passes. Then the iOS build + test commands → `BUILD SUCCEEDED`, `TEST SUCCEEDED`.

- [ ] **Step 2: End-to-end smoke (only if Docker is available: `docker info` succeeds)**

```bash
docker compose -f infra/docker-compose.yml up -d --build && sleep 20
B=http://localhost:3000
C=$(curl -s -XPOST $B/consent-records -H 'content-type: application/json' -d '{"subjectPseudoId":"p-smoke","scopes":["derived_events"]}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
R=$(curl -s -XPOST $B/sessions -H 'content-type: application/json' -d "{\"subjectPseudoId\":\"p-smoke\",\"protocolId\":\"bodyweight-squat\",\"protocolVersion\":\"v0-draft\",\"deploymentContext\":\"clinic_supervised\",\"consentRecordId\":\"$C\",\"retentionPolicy\":{\"rawVideo\":{\"optIn\":false,\"retentionDays\":null},\"derivedEvents\":{\"retentionDays\":30}}}")
S=$(echo $R | python3 -c "import sys,json;print(json.load(sys.stdin)['session']['id'])"); T=$(echo $R | python3 -c "import sys,json;print(json.load(sys.stdin)['sessionToken'])")
echo "no token:   $(curl -s -o /dev/null -w '%{http_code}' -XPOST $B/sessions/$S/calibrate)"            # expect 401
echo "with token: $(curl -s -o /dev/null -w '%{http_code}' -XPOST $B/sessions/$S/calibrate -H "authorization: Bearer $T")"  # expect 201
echo "symptom, no token: $(curl -s -o /dev/null -w '%{http_code}' -XPOST $B/symptom-reports -H 'content-type: application/json' -d "{\"sessionId\":\"$S\",\"symptoms\":[\"other\"],\"severity\":\"mild\"}")"  # expect 201
echo "wrong consent: $(curl -s -o /dev/null -w '%{http_code}' -XPOST $B/sessions -H 'content-type: application/json' -d "{\"subjectPseudoId\":\"someone-else\",\"protocolId\":\"bodyweight-squat\",\"protocolVersion\":\"v0-draft\",\"deploymentContext\":\"clinic_supervised\",\"consentRecordId\":\"$C\",\"retentionPolicy\":{\"rawVideo\":{\"optIn\":false,\"retentionDays\":null},\"derivedEvents\":{\"retentionDays\":30}}}")"  # expect 403
docker compose -f infra/docker-compose.yml down
```

If Docker is unavailable, record that the end-to-end smoke was not run.
