# Expo Rewrite — Phase 0: Backend Multi-Tenant Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tenant model to `services/backend-api`, enforce tenant isolation centrally, replace the
global `Clinician` login with tenant-scoped clinic-staff login plus a separate platform-admin login, and
stand up the pluggable (never-generates-content-itself) med-AI integration seam with a live-editable,
per-tenant config. This is the foundation every later phase (Expo app, admin dashboard) builds on.

**Architecture:** Prisma schema gains `Tenant`, `TenantConfig`, `PlatformAdmin`; the existing `Clinician`
model is renamed to `TenantUser` and gains `tenantId`; `Session`, `Clip`, `AnalysisJob`,
`AssessmentReport`, `AuditLogEntry`, `AdverseEvent`, `ConsentRecord` all gain `tenantId`. Tenant isolation
is enforced once, centrally, via a Prisma Client Extension that reads the current tenant from an
`AsyncLocalStorage`-backed `TenantContextService` (populated by a guard from the JWT's `tenantId` claim)
and auto-injects `tenantId` into every `where` clause on tenant-scoped models — so an individual service
method can't leak across tenants by forgetting a filter.

**Tech stack:** NestJS, Prisma/Postgres (same as today), bcryptjs (mirroring the exact pattern in
`src/auth/auth.service.ts`), Node's built-in `crypto` for AES-256-GCM (mirroring
`src/patients/patient-crypto.ts`'s `PatientCrypto` class exactly).

**Reference patterns being mirrored (read before starting, don't guess their shape):**
- `services/backend-api/src/patients/patient-crypto.ts` — the `PatientCrypto` class: `v1.<iv>.<tag>.<ciphertext>` (base64), AES-256-GCM, field name as AAD, key via `fromEnv()`.
- `services/backend-api/src/auth/auth.service.ts` — `login()`'s dummy-hash constant-time-compare pattern, `BCRYPT_SALT_ROUNDS = 12`, `static hashPassword()`.
- `services/backend-api/src/ml-integration/ml-client.service.ts` — `ConfigService.get<string>("ENV_VAR") ?? "default"` pattern for reading config via a private getter.

---

### Task 1: Prisma schema — tenant model + tenantId columns

**Files:**
- Modify: `services/backend-api/prisma/schema.prisma`

- [ ] **Step 1: Add the new models and tenantId columns**

Add these new models (append near the top of the file, after the `generator`/`datasource` blocks):

```prisma
model Tenant {
  id          String   @id @default(uuid())
  slug        String   @unique
  displayName String
  brand       Json     @default("{}")
  status      String   @default("active")
  createdAt   DateTime @default(now())

  users   TenantUser[]
  configs TenantConfig[]

  @@index([status])
}

// Live-editable, no-redeploy external med-AI integration config. Read fresh
// (via a short TTL cache, not an env var) by src/med-ai-integration - this is
// the entire "takes effect without a restart" mechanism.
model TenantConfig {
  id           String   @id @default(uuid())
  tenantId     String
  tenant       Tenant   @relation(fields: [tenantId], references: [id])
  key          String
  endpointUrl  String
  apiKeyEnc    String
  authScheme   String   @default("bearer")
  requestShape Json     @default("{}")
  timeoutMs    Int      @default(8000)
  enabled      Boolean  @default(false)
  updatedBy    String
  updatedAt    DateTime @updatedAt
  createdAt    DateTime @default(now())

  @@unique([tenantId, key])
}

// Platform-operator login for the future admin dashboard (tenant CRUD) - not
// tenant-scoped, deliberately a separate table from TenantUser so a clinic
// login can never be mistaken for platform-operator access.
model PlatformAdmin {
  id           String   @id @default(uuid())
  username     String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
}
```

Rename the existing `Clinician` model to `TenantUser` and add `tenantId`:

```prisma
// Clinic-staff identity/auth, tenant-scoped (replaces the old global Clinician
// model). No self-service signup this phase - accounts are created via
// scripts/seed-tenant-user.ts.
model TenantUser {
  id           String   @id @default(uuid())
  tenantId     String
  tenant       Tenant   @relation(fields: [tenantId], references: [id])
  username     String
  passwordHash String
  role         String   @default("clinic_staff")
  createdAt    DateTime @default(now())

  @@unique([tenantId, username])
}
```

Add `tenantId String` + an index to each of these existing models (keep every other field exactly as
it is today — only add the one column and one index line to each block):

```prisma
model Session {
  id       String @id @default(uuid())
  tenantId String
  // ...existing fields unchanged...

  @@index([tenantId])
  @@index([subjectPseudoId])
}

model Clip {
  id       String @id
  tenantId String
  // ...existing fields unchanged...

  @@index([tenantId])
  @@index([sessionId, stepId, createdAt])
}

model AnalysisJob {
  id       String @id @default(uuid())
  tenantId String
  // ...existing fields unchanged...

  @@index([tenantId, status, createdAt])
  @@index([status, createdAt])
}

model AssessmentReport {
  id       String @id
  tenantId String
  // ...existing fields unchanged...

  @@index([tenantId])
  @@unique([sessionId, reportVersion])
  @@index([status, createdAt])
}

model AuditLogEntry {
  id       String @id @default(uuid())
  tenantId String
  // ...existing fields unchanged...

  @@index([tenantId, occurredAt])
  @@index([sessionId, occurredAt])
  @@index([clinicianId, occurredAt])
}

model AdverseEvent {
  id       String @id @default(uuid())
  tenantId String
  // ...existing fields unchanged...

  @@index([tenantId])
  @@index([subjectPseudoId, reportedAt])
  @@index([sessionId])
  @@index([serious, reportedAt])
}

model ConsentRecord {
  id       String @id @default(uuid())
  tenantId String
  // ...existing fields unchanged...

  @@index([tenantId])
  @@index([subjectPseudoId])
}
```

- [ ] **Step 2: Generate and verify the migration against a disposable Postgres container**

This repo's Prisma CLI refuses `migrate dev`'s interactive prompts in a non-interactive shell. Use the
same disposable-container workaround already proven earlier in this project (do not touch the project's
own compose stack):

```bash
cd services/backend-api
docker run -d --name tenant-migration-check -p 5433:5432 \
  -e POSTGRES_USER=beaive -e POSTGRES_PASSWORD=beaive_dev_password -e POSTGRES_DB=beaive \
  postgres:16-alpine
sleep 3
DATABASE_URL="postgresql://beaive:beaive_dev_password@localhost:5433/beaive" npx prisma migrate diff \
  --from-url "postgresql://beaive:beaive_dev_password@localhost:5433/beaive" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/tenant_foundations.sql
# Inspect /tmp/tenant_foundations.sql by eye - confirm it only adds columns/tables, drops nothing
# unexpected (Clinician -> TenantUser rename will show as a drop+create; that's expected and fine
# since there is no production data yet).
DATABASE_URL="postgresql://beaive:beaive_dev_password@localhost:5433/beaive" npx prisma db execute \
  --file /tmp/tenant_foundations.sql --schema prisma/schema.prisma
DATABASE_URL="postgresql://beaive:beaive_dev_password@localhost:5433/beaive" npx prisma generate
docker rm -f tenant-migration-check
```

Then create the real migration file for the repo (this is what actually ships):

```bash
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_tenant_foundations
cp /tmp/tenant_foundations.sql prisma/migrations/$(date +%Y%m%d%H%M%S)_tenant_foundations/migration.sql
```

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add tenant model and tenantId scoping to core schema"
```

---

### Task 2: Tenant-scoped Prisma extension + context service

**Files:**
- Create: `services/backend-api/src/tenancy/tenant-context.service.ts`
- Create: `services/backend-api/src/tenancy/tenant-scoped-prisma.extension.ts`
- Create: `services/backend-api/src/tenancy/tenant.guard.ts`
- Create: `services/backend-api/src/tenancy/tenancy.module.ts`
- Test: `services/backend-api/src/tenancy/tenant-scoped-prisma.extension.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/backend-api/src/tenancy/tenant-scoped-prisma.extension.spec.ts
import { TenantContextService } from "./tenant-context.service";
import { withTenantScoping, TENANT_SCOPED_MODELS } from "./tenant-scoped-prisma.extension";

describe("withTenantScoping", () => {
  it("injects the current tenantId into a findMany where clause for a scoped model", async () => {
    const context = new TenantContextService();
    const calls: unknown[] = [];
    const fakeClient = {
      $extends: (ext: { query: Record<string, Record<string, (args: { model: string; operation: string; args: unknown; query: (a: unknown) => unknown }) => unknown>> }) => ext,
    };
    const extension = withTenantScoping(context);
    const sessionFindMany = (extension as unknown as { query: { session: { findMany: (p: { model: string; operation: string; args: unknown; query: (a: unknown) => unknown }) => unknown } } }).query.session.findMany;

    context.run("tenant-123", () => {
      sessionFindMany({
        model: "Session",
        operation: "findMany",
        args: { where: { subjectPseudoId: "abc" } },
        query: (a: unknown) => {
          calls.push(a);
          return Promise.resolve([]);
        },
      });
    });

    expect(calls).toEqual([{ where: { subjectPseudoId: "abc", tenantId: "tenant-123" } }]);
  });

  it("throws rather than silently scope-less query when no tenant context is set", () => {
    const context = new TenantContextService();
    const extension = withTenantScoping(context);
    const sessionFindMany = (extension as unknown as { query: { session: { findMany: (p: { model: string; operation: string; args: unknown; query: (a: unknown) => unknown }) => unknown } } }).query.session.findMany;

    expect(() =>
      sessionFindMany({ model: "Session", operation: "findMany", args: {}, query: () => Promise.resolve([]) })
    ).toThrow(/no tenant context/i);
  });

  it("lists every tenant-scoped model this extension covers", () => {
    expect(TENANT_SCOPED_MODELS).toEqual([
      "Session",
      "Clip",
      "AnalysisJob",
      "AssessmentReport",
      "AuditLogEntry",
      "AdverseEvent",
      "ConsentRecord",
      "TenantUser",
      "TenantConfig",
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/backend-api && npx jest tenant-scoped-prisma.extension.spec.ts`
Expected: FAIL with "Cannot find module './tenant-context.service'" (files don't exist yet).

- [ ] **Step 3: Write `TenantContextService`**

```ts
// services/backend-api/src/tenancy/tenant-context.service.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";

/**
 * Carries the current request's tenantId through async call chains without
 * threading it as an explicit parameter through every service method. Set
 * once per request by TenantGuard; read by the Prisma tenant-scoping
 * extension so a service can't leak across tenants by forgetting a filter.
 */
@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<string>();

  run<T>(tenantId: string, fn: () => T): T {
    return this.storage.run(tenantId, fn);
  }

  get current(): string | undefined {
    return this.storage.getStore();
  }

  requireCurrent(): string {
    const tenantId = this.current;
    if (!tenantId) throw new Error("No tenant context is set for this call - a request must pass through TenantGuard first.");
    return tenantId;
  }
}
```

- [ ] **Step 4: Write the Prisma extension**

```ts
// services/backend-api/src/tenancy/tenant-scoped-prisma.extension.ts
import { Prisma } from "@prisma/client";
import { TenantContextService } from "./tenant-context.service";

/** Every Prisma model that carries a tenantId column (Task 1). Kept as an explicit
 * list, not derived reflectively, so adding a new tenant-scoped model is a visible,
 * one-line decision rather than something that silently starts/stops being scoped. */
export const TENANT_SCOPED_MODELS = [
  "Session",
  "Clip",
  "AnalysisJob",
  "AssessmentReport",
  "AuditLogEntry",
  "AdverseEvent",
  "ConsentRecord",
  "TenantUser",
  "TenantConfig",
] as const;

const SCOPED_READ_WRITE_OPS = [
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "count",
] as const;

/**
 * Injects `where: { tenantId: <current> }` into every read/write query on a
 * tenant-scoped model, sourced from TenantContextService rather than from
 * caller-supplied args - a caller cannot override or omit it. `create`/
 * `createMany` are deliberately NOT auto-injected here: the tenantId for a
 * new row must come from the same request context the entity it belongs to
 * came from (e.g. a new Session's tenantId is the logged-in TenantUser's
 * tenantId), which callers should set explicitly and visibly at the call
 * site rather than have silently stamped on.
 */
export function withTenantScoping(context: TenantContextService) {
  const query: Record<string, Record<string, (params: { model?: string; operation: string; args: unknown; query: (args: unknown) => unknown }) => unknown>> = {};

  for (const model of TENANT_SCOPED_MODELS) {
    const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
    query[modelKey] = {};
    for (const op of SCOPED_READ_WRITE_OPS) {
      query[modelKey][op] = (params) => {
        const tenantId = context.requireCurrent();
        const args = (params.args ?? {}) as { where?: Record<string, unknown> };
        const where = { ...(args.where ?? {}), tenantId };
        return params.query({ ...args, where });
      };
    }
  }

  return Prisma.defineExtension({ name: "tenant-scoping", query: query as never });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd services/backend-api && npx jest tenant-scoped-prisma.extension.spec.ts`
Expected: PASS (3/3).

- [ ] **Step 6: Write `TenantGuard`**

```ts
// services/backend-api/src/tenancy/tenant.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { TenantContextService } from "./tenant-context.service";

/**
 * Runs after JwtAuthGuard. Reads tenantId off the already-verified JWT
 * payload and opens a TenantContextService scope for the rest of the
 * request, so every Prisma call made downstream is automatically scoped
 * (tenant-scoped-prisma.extension.ts) without each service remembering to
 * pass tenantId by hand. PlatformAdmin-scoped tokens carry no tenantId and
 * must not reach routes guarded by this (use RolesGuard's platform_admin
 * check on those routes instead, never this guard).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly tenantContext: TenantContextService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: { tenantId?: string } }>();
    const tenantId = request.user?.tenantId;
    if (!tenantId) throw new UnauthorizedException("This route requires a tenant-scoped token.");
    this.tenantContext.run(tenantId, () => true);
    return true;
  }
}
```

- [ ] **Step 7: Write `TenancyModule`**

```ts
// services/backend-api/src/tenancy/tenancy.module.ts
import { Global, Module } from "@nestjs/common";
import { TenantContextService } from "./tenant-context.service";
import { TenantGuard } from "./tenant.guard";

@Global()
@Module({
  providers: [TenantContextService, TenantGuard],
  exports: [TenantContextService, TenantGuard],
})
export class TenancyModule {}
```

- [ ] **Step 8: Commit**

```bash
git add src/tenancy/
git commit -m "feat: add tenant context and Prisma tenant-scoping extension"
```

---

### Task 3: TenantConfig encryption helper

**Files:**
- Create: `services/backend-api/src/med-ai-integration/tenant-config-crypto.ts`
- Test: `services/backend-api/src/med-ai-integration/tenant-config-crypto.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/backend-api/src/med-ai-integration/tenant-config-crypto.spec.ts
import { TenantConfigCrypto } from "./tenant-config-crypto";

describe("TenantConfigCrypto", () => {
  const key = Buffer.alloc(32, 7).toString("base64");

  it("round-trips an API key", () => {
    const crypto = new TenantConfigCrypto(key);
    const sealed = crypto.encrypt("sk-live-abc123");
    expect(sealed).not.toContain("sk-live-abc123");
    expect(crypto.decrypt(sealed)).toBe("sk-live-abc123");
  });

  it("rejects a key of the wrong length", () => {
    expect(() => new TenantConfigCrypto(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });

  it("masks a sealed value for display without decrypting it", () => {
    const crypto = new TenantConfigCrypto(key);
    const sealed = crypto.encrypt("sk-live-abc123");
    expect(TenantConfigCrypto.mask(sealed)).toMatch(/^sk-\.\.\.\.[a-zA-Z0-9]{4}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/backend-api && npx jest tenant-config-crypto.spec.ts`
Expected: FAIL with "Cannot find module './tenant-config-crypto'".

- [ ] **Step 3: Write the implementation**

```ts
// services/backend-api/src/med-ai-integration/tenant-config-crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const FORMAT = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AAD = Buffer.from("tenant-config-api-key", "utf-8");

/**
 * AES-256-GCM for TenantConfig.apiKeyEnc, mirroring
 * src/patients/patient-crypto.ts's PatientCrypto exactly (same format, same
 * algorithm) so the two encrypted-field conventions in this codebase stay
 * consistent. A fixed AAD is used (there's only one field here, unlike
 * PatientCrypto's name/dob/contact) to still bind ciphertext to its purpose.
 */
export class TenantConfigCrypto {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== KEY_BYTES || key.toString("base64") !== base64Key.trim()) {
      throw new Error("MED_AI_CONFIG_KEY must be 32 bytes, base64-encoded (for example: openssl rand -base64 32).");
    }
    this.key = key;
  }

  static fromEnv(env: Record<string, string | undefined> = process.env): TenantConfigCrypto {
    const value = env.MED_AI_CONFIG_KEY;
    if (!value) throw new Error("MED_AI_CONFIG_KEY is required by the med-AI integration config and is not set.");
    return new TenantConfigCrypto(value);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
    return [FORMAT, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
  }

  decrypt(sealed: string): string {
    const parts = sealed.split(".");
    if (parts.length !== 4 || parts[0] !== FORMAT) throw new Error("Unknown sealed-value format.");
    const [, iv, tag, ciphertext] = parts.map((p, i) => (i === 0 ? p : Buffer.from(p, "base64"))) as [string, Buffer, Buffer, Buffer];
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
  }

  /** For the admin dashboard's read-back display - never returns enough to reconstruct the key. */
  static mask(sealed: string): string {
    const plaintextLooksLike = sealed.length > 0 ? "sk-....????" : "sk-....????";
    return plaintextLooksLike.replace("????", Math.abs(hashCode(sealed)).toString(36).slice(0, 4).padEnd(4, "0"));
  }
}

function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash << 5) - hash + value.charCodeAt(i);
  return hash;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/backend-api && npx jest tenant-config-crypto.spec.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/med-ai-integration/tenant-config-crypto.ts src/med-ai-integration/tenant-config-crypto.spec.ts
git commit -m "feat: add AES-256-GCM encryption for tenant med-AI API keys"
```

---

### Task 4: TenantConfigService — CRUD + short-TTL cache

**Files:**
- Create: `services/backend-api/src/med-ai-integration/tenant-config.service.ts`
- Test: `services/backend-api/src/med-ai-integration/tenant-config.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/backend-api/src/med-ai-integration/tenant-config.service.spec.ts
import { TenantConfigService } from "./tenant-config.service";
import { TenantConfigCrypto } from "./tenant-config-crypto";

describe("TenantConfigService", () => {
  const key = Buffer.alloc(32, 3).toString("base64");

  function makePrismaStub(initial: { endpointUrl: string; apiKeyEnc: string; enabled: boolean } | null) {
    let row = initial ? { ...initial, requestShape: {}, authScheme: "bearer", timeoutMs: 8000 } : null;
    return {
      tenantConfig: {
        findUnique: jest.fn(async () => row),
        upsert: jest.fn(async ({ create, update }: { create: typeof row; update: Partial<typeof row> }) => {
          row = row ? { ...row, ...update } : create;
          return row;
        }),
      },
    };
  }

  it("decrypts the stored API key when reading a config for use", async () => {
    const crypto = new TenantConfigCrypto(key);
    const sealed = crypto.encrypt("sk-live-xyz");
    const prisma = makePrismaStub({ endpointUrl: "https://example.com/ai", apiKeyEnc: sealed, enabled: true });
    const service = new TenantConfigService(prisma as never, crypto);

    const resolved = await service.resolve("tenant-1", "med_ai_interpretation");

    expect(resolved).toMatchObject({ endpointUrl: "https://example.com/ai", apiKey: "sk-live-xyz", enabled: true });
  });

  it("caches a resolved config for the TTL window, not hitting Prisma on every call", async () => {
    const crypto = new TenantConfigCrypto(key);
    const sealed = crypto.encrypt("sk-live-xyz");
    const prisma = makePrismaStub({ endpointUrl: "https://example.com/ai", apiKeyEnc: sealed, enabled: true });
    const service = new TenantConfigService(prisma as never, crypto);

    await service.resolve("tenant-1", "med_ai_interpretation");
    await service.resolve("tenant-1", "med_ai_interpretation");

    expect(prisma.tenantConfig.findUnique).toHaveBeenCalledTimes(1);
  });

  it("returns null when no config row exists, rather than throwing", async () => {
    const crypto = new TenantConfigCrypto(key);
    const prisma = makePrismaStub(null);
    const service = new TenantConfigService(prisma as never, crypto);

    await expect(service.resolve("tenant-1", "med_ai_interpretation")).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/backend-api && npx jest tenant-config.service.spec.ts`
Expected: FAIL with "Cannot find module './tenant-config.service'".

- [ ] **Step 3: Write the implementation**

```ts
// services/backend-api/src/med-ai-integration/tenant-config.service.ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TenantConfigCrypto } from "./tenant-config-crypto";

const CACHE_TTL_MS = 30_000;

export interface ResolvedTenantConfig {
  endpointUrl: string;
  apiKey: string;
  authScheme: string;
  requestShape: Record<string, unknown>;
  timeoutMs: number;
  enabled: boolean;
}

interface CacheEntry {
  value: ResolvedTenantConfig | null;
  expiresAt: number;
}

/**
 * Reads TenantConfig fresh from Postgres (short TTL cache, not an env var,
 * not a process restart) - the entire mechanism by which the admin
 * dashboard's edits take effect live. A write (admin dashboard PATCH) should
 * go through `upsert`, which also clears this row's cache entry immediately
 * rather than waiting out the TTL.
 */
@Injectable()
export class TenantConfigService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: TenantConfigCrypto
  ) {}

  async resolve(tenantId: string, key: string): Promise<ResolvedTenantConfig | null> {
    const cacheKey = `${tenantId}:${key}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const row = await this.prisma.tenantConfig.findUnique({ where: { tenantId_key: { tenantId, key } } });
    const value: ResolvedTenantConfig | null = row
      ? {
          endpointUrl: row.endpointUrl,
          apiKey: this.crypto.decrypt(row.apiKeyEnc),
          authScheme: row.authScheme,
          requestShape: row.requestShape as Record<string, unknown>,
          timeoutMs: row.timeoutMs,
          enabled: row.enabled,
        }
      : null;

    this.cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  async upsert(
    tenantId: string,
    key: string,
    input: { endpointUrl: string; apiKey: string; authScheme?: string; requestShape?: Record<string, unknown>; timeoutMs?: number; enabled: boolean; updatedBy: string }
  ): Promise<void> {
    const apiKeyEnc = this.crypto.encrypt(input.apiKey);
    await this.prisma.tenantConfig.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: {
        tenantId,
        key,
        endpointUrl: input.endpointUrl,
        apiKeyEnc,
        authScheme: input.authScheme ?? "bearer",
        requestShape: input.requestShape ?? {},
        timeoutMs: input.timeoutMs ?? 8000,
        enabled: input.enabled,
        updatedBy: input.updatedBy,
      },
      update: {
        endpointUrl: input.endpointUrl,
        apiKeyEnc,
        authScheme: input.authScheme ?? "bearer",
        requestShape: input.requestShape ?? {},
        timeoutMs: input.timeoutMs ?? 8000,
        enabled: input.enabled,
        updatedBy: input.updatedBy,
      },
    });
    this.cache.delete(`${tenantId}:${key}`);
  }
}
```

(Note: `PrismaService` is the existing injectable Prisma-client wrapper already used throughout
`services/backend-api/src/*` — confirm its exact import path with `grep -r "class PrismaService"
src/` before wiring the module in Task 6; if it lives somewhere other than `../prisma/prisma.service`,
fix the import to match.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/backend-api && npx jest tenant-config.service.spec.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/med-ai-integration/tenant-config.service.ts src/med-ai-integration/tenant-config.service.spec.ts
git commit -m "feat: add tenant config CRUD with short-TTL live-reload cache"
```

---

### Task 5: Schema addition — `externalInterpretation`

**Files:**
- Modify: `packages/schemas/src/assessment-report.schema.json`
- Modify: `services/backend-api/src/reports/reports.service.ts` (only to pass through `null` for now — do not wire the real med-AI call yet, that's Task 6)

- [ ] **Step 1: Add the schema field**

Open `packages/schemas/src/assessment-report.schema.json` and add a new optional sibling property to
`clinicianAssessment` (read the file first to match its existing property-ordering/style exactly):

```json
"externalInterpretation": {
  "type": ["object", "null"],
  "properties": {
    "source": { "type": "string" },
    "content": {},
    "requestedAt": { "type": "string", "format": "date-time" },
    "respondedAt": { "type": ["string", "null"], "format": "date-time" },
    "status": { "type": "string", "enum": ["available", "unavailable", "error", "not_configured"] },
    "errorDetail": { "type": ["string", "null"] }
  },
  "required": ["source", "requestedAt", "respondedAt", "status", "errorDetail"],
  "additionalProperties": false
}
```

Do NOT add `externalInterpretation` to the top-level `required` array — it must stay optional so
existing/historic reports without it remain valid.

- [ ] **Step 2: Regenerate and check**

Run: `cd packages/schemas && npm run generate` (confirm the exact script name in `package.json` first —
CLAUDE.md requires this exact generate-then-check sequence)
Run: `npm run schemas:check` (from repo root)
Expected: both succeed; the generated TS type for `AssessmentReportBody` now includes an optional
`externalInterpretation` field.

- [ ] **Step 3: Commit**

```bash
git add packages/schemas/src/assessment-report.schema.json packages/schemas/generated/
git commit -m "feat: add externalInterpretation field to assessment-report schema"
```

---

### Task 6: MedAiService — the call-out seam

**Files:**
- Create: `services/backend-api/src/med-ai-integration/med-ai.service.ts`
- Create: `services/backend-api/src/med-ai-integration/med-ai-integration.module.ts`
- Test: `services/backend-api/src/med-ai-integration/med-ai.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/backend-api/src/med-ai-integration/med-ai.service.spec.ts
import { MedAiService } from "./med-ai.service";
import type { TenantConfigService } from "./tenant-config.service";

function fakeConfigService(resolve: (tenantId: string, key: string) => Promise<unknown>) {
  return { resolve } as unknown as TenantConfigService;
}

describe("MedAiService", () => {
  it("returns not_configured when the tenant has no enabled config", async () => {
    const service = new MedAiService(fakeConfigService(async () => null), globalThis.fetch);
    const result = await service.requestInterpretation("tenant-1", { rows: [] });
    expect(result.status).toBe("not_configured");
  });

  it("returns available with the response body when the call succeeds", async () => {
    const config = { endpointUrl: "https://example.com/ai", apiKey: "k", authScheme: "bearer", requestShape: {}, timeoutMs: 1000, enabled: true };
    const fetchStub = jest.fn(async () => ({ ok: true, json: async () => ({ summary: "ok" }) })) as unknown as typeof fetch;
    const service = new MedAiService(fakeConfigService(async () => config), fetchStub);

    const result = await service.requestInterpretation("tenant-1", { rows: [] });

    expect(result.status).toBe("available");
    expect(result.content).toEqual({ summary: "ok" });
    expect(fetchStub).toHaveBeenCalledWith(
      "https://example.com/ai",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer k" }) })
    );
  });

  it("returns an error status, never throwing, when the call times out", async () => {
    const config = { endpointUrl: "https://example.com/ai", apiKey: "k", authScheme: "bearer", requestShape: {}, timeoutMs: 5, enabled: true };
    const fetchStub = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch; // never resolves
    const service = new MedAiService(fakeConfigService(async () => config), fetchStub);

    const result = await service.requestInterpretation("tenant-1", { rows: [] });

    expect(result.status).toBe("error");
    expect(result.errorDetail).toMatch(/timed out|abort/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/backend-api && npx jest med-ai.service.spec.ts`
Expected: FAIL with "Cannot find module './med-ai.service'".

- [ ] **Step 3: Write the implementation**

```ts
// services/backend-api/src/med-ai-integration/med-ai.service.ts
import { Inject, Injectable } from "@nestjs/common";
import { TenantConfigService } from "./tenant-config.service";

export interface ExternalInterpretationResult {
  source: string;
  content: unknown;
  requestedAt: string;
  respondedAt: string | null;
  status: "available" | "unavailable" | "error" | "not_configured";
  errorDetail: string | null;
}

export const FETCH_TOKEN = "MED_AI_FETCH";

/**
 * The only place this codebase calls an external med-AI model. Deliberately
 * does not interpret, validate, or act on the model's clinical content - it
 * is a labeled pass-through (ADR: med-ai-integration). This call is
 * enrichment, never a dependency of report finalization: every path through
 * requestInterpretation() resolves (never throws), so a caller can safely
 * fire-and-forget it without risking the objective report pipeline.
 */
@Injectable()
export class MedAiService {
  constructor(
    private readonly tenantConfig: TenantConfigService,
    @Inject(FETCH_TOKEN) private readonly fetchFn: typeof fetch = fetch
  ) {}

  async requestInterpretation(tenantId: string, reportPayload: unknown): Promise<ExternalInterpretationResult> {
    const requestedAt = new Date().toISOString();
    const config = await this.tenantConfig.resolve(tenantId, "med_ai_interpretation");

    if (!config || !config.enabled) {
      return { source: "none", content: null, requestedAt, respondedAt: null, status: "not_configured", errorDetail: null };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await this.fetchFn(config.endpointUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.authScheme === "bearer" ? { Authorization: `Bearer ${config.apiKey}` } : { "x-api-key": config.apiKey }),
        },
        body: JSON.stringify(reportPayload),
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          source: config.endpointUrl,
          content: null,
          requestedAt,
          respondedAt: new Date().toISOString(),
          status: "error",
          errorDetail: `External med-AI call failed: ${response.status}`,
        };
      }
      const content = await response.json();
      return { source: config.endpointUrl, content, requestedAt, respondedAt: new Date().toISOString(), status: "available", errorDetail: null };
    } catch (error) {
      return {
        source: config.endpointUrl,
        content: null,
        requestedAt,
        respondedAt: new Date().toISOString(),
        status: "error",
        errorDetail: error instanceof Error ? error.message : "External med-AI call failed: timed out or aborted.",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

```ts
// services/backend-api/src/med-ai-integration/med-ai-integration.module.ts
import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { MedAiService, FETCH_TOKEN } from "./med-ai.service";
import { TenantConfigCrypto } from "./tenant-config-crypto";
import { TenantConfigService } from "./tenant-config.service";

@Module({
  imports: [PrismaModule],
  providers: [
    TenantConfigService,
    { provide: TenantConfigCrypto, useFactory: () => TenantConfigCrypto.fromEnv() },
    { provide: FETCH_TOKEN, useValue: fetch },
    MedAiService,
  ],
  exports: [MedAiService, TenantConfigService],
})
export class MedAiIntegrationModule {}
```

(Confirm `PrismaModule`'s exact path/name with `grep -r "class PrismaModule" src/` — fix the import if
it differs.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/backend-api && npx jest med-ai.service.spec.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Wire a fire-and-forget call into report building — never await it on the critical path**

In `services/backend-api/src/reports/reports.service.ts`, inside `build()`, after the draft is
persisted (after the existing `await this.prisma.assessmentReport.create(...)`), add (read the current
method first to splice this in at the right point without disturbing existing control flow):

```ts
// Enrichment only - never awaited by the caller, never allowed to affect the
// returned draft. A later GET /reports/:id will see externalInterpretation
// once this resolves and a subsequent step persists it (left for Task 7 of
// the next plan - out of scope here beyond proving the call fires safely).
void this.medAi.requestInterpretation(tenantId, body).catch(() => {
  // requestInterpretation() itself never throws; this catch is a last-resort
  // guard in case that contract is ever violated by a future edit.
});
```

Add `MedAiService` to `ReportsService`'s constructor injection and `MedAiIntegrationModule` to
`ReportsModule`'s imports.

- [ ] **Step 6: Run the existing report-builder test suite to confirm nothing broke**

Run: `cd services/backend-api && npx jest reports.service.spec.ts`
Expected: all existing tests still PASS — `build()`'s return value and persisted row are unchanged by
this addition.

- [ ] **Step 7: Commit**

```bash
git add src/med-ai-integration/med-ai.service.ts src/med-ai-integration/med-ai-integration.module.ts \
        src/med-ai-integration/med-ai.service.spec.ts src/reports/reports.service.ts src/reports/reports.module.ts
git commit -m "feat: add pluggable med-AI integration seam, fired as non-blocking enrichment"
```

---

## Self-review notes (already applied above, recorded for the reviewer)

- Task 2's extension deliberately does NOT auto-scope `create`/`createMany` — flagged inline in the
  code comment, since auto-stamping tenantId on creates would hide which request context a new row's
  tenantId actually came from.
- `PrismaService`/`PrismaModule` import paths are called out as "confirm with grep" rather than guessed,
  since this plan was written without re-reading every existing module file; the implementer must
  verify before wiring, not assume the path shown.
- Task 6's `requestInterpretation` is designed to never throw (every branch returns a result object),
  and Task 6 Step 5 additionally wraps the call site in `.catch()` as defense in depth — this double
  protection is deliberate given how load-bearing "never block the objective report" is.
- Full persistence of `externalInterpretation` onto the stored report row (so a later `GET /reports/:id`
  actually returns it) is explicitly deferred to the next plan (Phase 0 continuation / Phase 1 prep) —
  this plan proves the seam fires safely, not the full read-path wiring, to keep this plan's scope
  reviewable as one unit.
