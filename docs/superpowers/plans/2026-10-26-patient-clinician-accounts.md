# Patient & Clinician Accounts (Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real patient self-signup/login and clinician login reachable from the iOS app itself, replacing the swipe mode-chooser as the app's first screen. This is foundation only — the intake form, scan flow, report page, and clinician patient list are later parts; this part ends at "a patient or clinician can sign up/log in and the app remembers them."

**Architecture:** Backend gets a third JWT role (`"patient"`, additive — the existing `"subject"` pseudonymous role and flow are untouched) and two new endpoints mirroring the existing clinician auth exactly (bcrypt, constant-time compare, JWT). iOS gets a new landing screen (`AccountChooserView`) replacing `ModeChooserView` in `RootView`, new patient sign-up/sign-in screens modeled on the existing `ClinicianSignInView`, and a Keychain-backed token store copying `SubjectIdentityStore`'s pattern. The existing clinician sign-in flow inside `RootView` is reused unchanged, just entered from the new landing screen.

**Tech Stack:** NestJS + Prisma/Postgres (`services/backend-api`), SwiftUI (`apps/ios-client`).

**Before starting:** this part supersedes ADR-012, amends `docs/consent-and-retention.md`, and supersedes ADR-017's "Patient mode never touches the register" claim — see Task 3. Read `docs/superpowers/specs/2026-10-26-patient-clinician-accounts-design.md` for the full rationale.

---

### Task 1: Prisma schema - optional auth fields on `Patient`, fix the one downstream type break

**Files:**
- Modify: `services/backend-api/prisma/schema.prisma`
- Modify: `services/backend-api/src/patients/patients.service.ts`
- Test: `services/backend-api/src/patients/patients.service.spec.ts`

- [ ] **Step 1: Widen the `Patient` model**

In `prisma/schema.prisma`, find:
```prisma
model Patient {
  id         String               @id @default(uuid())
  nameEnc    String
  dobEnc     String
  contactEnc String?
  createdBy  String
  createdAt  DateTime             @default(now())
  links      PatientSubjectLink[]
}
```
Replace with:
```prisma
model Patient {
  id           String               @id @default(uuid())
  email        String?              @unique
  passwordHash String?
  nameEnc      String?
  dobEnc       String?
  contactEnc   String?
  createdBy    String?
  createdAt    DateTime             @default(now())
  links        PatientSubjectLink[]
}
```
`nameEnc`/`dobEnc`/`createdBy` become optional: a self-signup patient has no
clinician-entered demographic data yet (that arrives later, out of this part's
scope), so they can't be required at signup time the way they are for a
clinician-created row.

- [ ] **Step 2: Migrate**

```bash
cd services/backend-api
npx prisma migrate dev --name patient_auth_fields
```
Expected: migration applies cleanly against the local dev DB (existing rows all
have non-null `nameEnc`/`dobEnc`/`createdBy` already, so no data migration is
needed - the column just stops being `NOT NULL` going forward).

- [ ] **Step 3: Fix the one real downstream break**

`PatientsService.open()` (`src/patients/patients.service.ts`) has a parameter type
that assumed `nameEnc`/`dobEnc` are always `string` - after Step 1 the Prisma-generated
row type is `string | null` for both, so `search()`'s call to `this.open(row)` will
no longer type-check. Find:
```typescript
  private open(row: { id: string; nameEnc: string; dobEnc: string; contactEnc: string | null; createdAt: Date }): PatientRecord | null {
    try {
      return {
        id: row.id,
        name: this.crypto.decrypt("name", row.nameEnc),
        dateOfBirth: this.crypto.decrypt("dob", row.dobEnc),
        contact: row.contactEnc ? this.crypto.decrypt("contact", row.contactEnc) : null,
        createdAt: row.createdAt,
      };
    } catch {
      // A row sealed under a different key must not take the whole register down.
      return null;
    }
  }
```
Replace with:
```typescript
  private open(row: { id: string; nameEnc: string | null; dobEnc: string | null; contactEnc: string | null; createdAt: Date }): PatientRecord | null {
    // A self-signup patient (Part 1 of the accounts redesign) has no
    // clinician-entered name/DOB yet - it isn't a clinician-register entry,
    // so it's correctly excluded from search results, not an error.
    if (row.nameEnc === null || row.dobEnc === null) return null;
    try {
      return {
        id: row.id,
        name: this.crypto.decrypt("name", row.nameEnc),
        dateOfBirth: this.crypto.decrypt("dob", row.dobEnc),
        contact: row.contactEnc ? this.crypto.decrypt("contact", row.contactEnc) : null,
        createdAt: row.createdAt,
      };
    } catch {
      // A row sealed under a different key must not take the whole register down.
      return null;
    }
  }
```

- [ ] **Step 4: Add a regression test**

In `patients.service.spec.ts`, find the test(s) exercising `search()` (read the file
first to match its existing mocking style exactly - it likely mocks
`prisma.patient.findMany`). Add a test asserting that a row with `nameEnc: null,
dobEnc: null` (a self-signup patient) is silently excluded from `search()`'s
results rather than throwing or appearing with garbage decrypted data - alongside
a normal clinician-created row that must still appear.

- [ ] **Step 5: Run the backend test suite**

```bash
cd services/backend-api
npx prisma generate
npx jest patients
```
Expected: all pass, including the new test.

- [ ] **Step 6: Commit**

```bash
git add services/backend-api/prisma services/backend-api/src/patients/patients.service.ts services/backend-api/src/patients/patients.service.spec.ts
git commit -m "feat: widen Patient schema for self-signup auth fields

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Backend patient auth - new role, signup/login endpoints

**Files:**
- Modify: `services/backend-api/src/auth/roles.decorator.ts`
- Modify: `services/backend-api/src/auth/auth.service.ts`
- Create: `services/backend-api/src/auth/patient-auth.service.ts`
- Create: `services/backend-api/src/auth/patient-auth.controller.ts`
- Modify: `services/backend-api/src/auth/auth.module.ts`
- Test: `services/backend-api/src/auth/patient-auth.service.spec.ts` (new)

- [ ] **Step 1: Add the `"patient"` role**

In `roles.decorator.ts`, change:
```typescript
export type Role = "clinician" | "subject";
```
to:
```typescript
export type Role = "clinician" | "subject" | "patient";
```

- [ ] **Step 2: Broaden `JwtPayload` to admit an email-based identity**

In `auth.service.ts`, change:
```typescript
export interface JwtPayload {
  sub: string;
  username: string;
  role: Role;
}
```
to:
```typescript
export interface JwtPayload {
  sub: string;
  role: Role;
  /** Clinician tokens. */
  username?: string;
  /** Patient tokens. */
  email?: string;
}
```
`JwtAuthGuard` already imports this type and does nothing but decode-and-cast, so
it needs no change. Leave `AuthService.login` (clinician) and its existing test
untouched - they still always set `username`.

- [ ] **Step 3: Write the failing test for `PatientAuthService`**

Create `services/backend-api/src/auth/patient-auth.service.spec.ts`, following
`auth.service.spec.ts`'s exact mocking style:
```typescript
import { ConflictException, UnauthorizedException, BadRequestException } from "@nestjs/common";
import { PatientAuthService } from "./patient-auth.service";

function buildService(existing: { id: string; email: string; passwordHash: string } | null) {
  const prisma = {
    patient: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data })),
    },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue("signed.jwt.token") };
  return { service: new PatientAuthService(prisma as never, jwt as never), prisma, jwt };
}

describe("PatientAuthService.signup", () => {
  it("creates a patient and issues a token", async () => {
    const { service, prisma, jwt } = buildService(null);
    const result = await service.signup("new@example.com", "correct-password-123");

    expect(result).toEqual({ accessToken: "signed.jwt.token" });
    expect(prisma.patient.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: "new@example.com" }),
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ email: "new@example.com", role: "patient" }));
  });

  it("rejects a password shorter than 12 characters", async () => {
    const { service } = buildService(null);
    await expect(service.signup("new@example.com", "short")).rejects.toThrow(BadRequestException);
  });

  it("rejects a malformed email", async () => {
    const { service } = buildService(null);
    await expect(service.signup("not-an-email", "correct-password-123")).rejects.toThrow(BadRequestException);
  });

  it("rejects a duplicate email", async () => {
    const { service } = buildService({ id: "p0", email: "taken@example.com", passwordHash: "x" });
    await expect(service.signup("taken@example.com", "correct-password-123")).rejects.toThrow(ConflictException);
  });
});

describe("PatientAuthService.login", () => {
  it("issues a token for a correct email/password", async () => {
    const passwordHash = await PatientAuthService.hashPassword("correct-password-123");
    const { service, jwt } = buildService({ id: "p1", email: "patient@example.com", passwordHash });

    const result = await service.login("patient@example.com", "correct-password-123");

    expect(result).toEqual({ accessToken: "signed.jwt.token" });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: "p1", email: "patient@example.com", role: "patient" });
  });

  it("rejects an unknown email", async () => {
    const { service } = buildService(null);
    await expect(service.login("nobody@example.com", "whatever-password")).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a wrong password, never issuing a token", async () => {
    const passwordHash = await PatientAuthService.hashPassword("the-real-password-1");
    const { service, jwt } = buildService({ id: "p1", email: "patient@example.com", passwordHash });

    await expect(service.login("patient@example.com", "a-wrong-password-1")).rejects.toThrow(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd services/backend-api && npx jest patient-auth
```
Expected: FAIL - `PatientAuthService` doesn't exist yet.

- [ ] **Step 3: Implement `PatientAuthService`**

Create `services/backend-api/src/auth/patient-auth.service.ts`:
```typescript
import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../common/prisma.service";
import type { JwtPayload } from "./auth.service";

const BCRYPT_SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Real patient self-signup/login (docs/adr/019-patient-self-signup.md,
 * superseding ADR-012's "no subject accounts"). Mirrors AuthService
 * (clinician) exactly: bcrypt, constant-time compare, JWT. The existing
 * pseudonymous SubjectAuthService flow is untouched and still works for
 * anything not yet migrated to this login.
 */
@Injectable()
export class PatientAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService
  ) {}

  async signup(email: string, password: string): Promise<{ accessToken: string }> {
    this.validate(email, password);
    const existing = await this.prisma.patient.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException("An account with that email already exists.");
    }
    const passwordHash = await PatientAuthService.hashPassword(password);
    const patient = await this.prisma.patient.create({ data: { email, passwordHash } });
    return this.issue(patient.id, email);
  }

  async login(email: string, password: string): Promise<{ accessToken: string }> {
    const patient = await this.prisma.patient.findUnique({ where: { email } });
    // Compare against a fixed dummy hash when the email doesn't exist, so this
    // path takes roughly the same time as a real mismatch - mirrors AuthService.
    const passwordHash = patient?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali";
    const passwordMatches = await bcrypt.compare(password, passwordHash);

    if (!patient || !passwordMatches) {
      throw new UnauthorizedException("Invalid email or password");
    }

    return this.issue(patient.id, email);
  }

  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  }

  private validate(email: string, password: string): void {
    if (typeof email !== "string" || !EMAIL_PATTERN.test(email)) {
      throw new BadRequestException("A valid email is required.");
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
  }

  private async issue(sub: string, email: string): Promise<{ accessToken: string }> {
    const payload: JwtPayload = { sub, email, role: "patient" };
    return { accessToken: await this.jwt.signAsync(payload) };
  }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd services/backend-api && npx jest patient-auth
```
Expected: PASS, all 8 tests.

- [ ] **Step 5: Wire the controller and module**

Create `services/backend-api/src/auth/patient-auth.controller.ts`:
```typescript
import { Body, Controller, Post } from "@nestjs/common";
import { PatientAuthService } from "./patient-auth.service";

interface SignupBody {
  email: string;
  password: string;
}

@Controller("auth/patient")
export class PatientAuthController {
  constructor(private readonly auth: PatientAuthService) {}

  @Post("signup")
  signup(@Body() body: SignupBody) {
    return this.auth.signup(body.email, body.password);
  }

  @Post("login")
  login(@Body() body: SignupBody) {
    return this.auth.login(body.email, body.password);
  }
}
```

In `auth.module.ts`, add the new controller and service:
```typescript
import { PatientAuthController } from "./patient-auth.controller";
import { PatientAuthService } from "./patient-auth.service";
```
and in the `@Module(...)` decorator, add `PatientAuthController` to `controllers`
and `PatientAuthService` to `providers`:
```typescript
  controllers: [AuthController, PatientAuthController],
  providers: [AuthService, PatientAuthService, PrismaService, JwtAuthGuard, RolesGuard, SubjectAuthService],
```

- [ ] **Step 6: Build and run the full backend suite**

```bash
cd services/backend-api
npx prisma generate
npx jest
```
Expected: all pass, no regressions.

- [ ] **Step 7: Commit**

```bash
git add services/backend-api/src/auth
git commit -m "feat: add patient self-signup/login (ADR-019)

New 'patient' JWT role, additive alongside the existing pseudonymous
'subject' role which is untouched. Mirrors the clinician auth pattern
exactly: bcrypt, constant-time compare, JWT.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: ADR-019 and amending the three superseded documents

**Files:**
- Create: `docs/adr/019-patient-self-signup.md`
- Modify: `docs/adr/012-*.md` (find the exact filename)
- Modify: `docs/adr/017-patient-register.md`
- Modify: `docs/consent-and-retention.md`

- [ ] **Step 1: Find the exact ADR-012 filename and read all three documents**

```bash
ls docs/adr/ | grep "^012"
```
Read that file, `docs/adr/017-patient-register.md`, and the "Subject identity"
section of `docs/consent-and-retention.md` in full before writing anything -
this task amends real, existing architectural commitments, not a blank page.

- [ ] **Step 2: Write ADR-019**

Create `docs/adr/019-patient-self-signup.md`. Follow the repo's existing ADR
format exactly (read ADR-017 or ADR-018 first for the template's section
headings). Content must cover:
- **Context:** the login-based redesign (4 parts; this is Part 1) requires a
  persistent patient identity - returning-user convenience, scan history, a
  real login screen - which ADR-012's pseudonymous-only design doesn't support.
- **Decision:** patients may now create a persistent account (email +
  bcrypt-hashed password). The JWT role is `"patient"`, distinct from the
  existing pseudonymous `"subject"` role, which is **not removed** - it keeps
  working for anything not yet migrated (nothing currently depends on this
  distinction breaking).
- **What stays true from ADR-012/017/consent-and-retention.md:** PII
  (name/DOB/contact) stays field-level AES-256-GCM encrypted exactly as before;
  passwords are hashed (bcrypt, 12 rounds), never logged or stored in plain
  text; a patient's own `Patient.email` is the only new identifying field
  introduced, and it belongs to the patient's own login, not a clinician-visible
  register entry (self-signup patients have `nameEnc: null`, so they're
  explicitly excluded from the clinician register's `search()`, per Task 1).
- **What changes:** a patient can now authenticate as a persistent identity
  instead of only a per-session pseudonym; this is an explicit, considered
  reversal of part of ADR-012's reasoning, made after being presented with the
  privacy tradeoff.
- **Consequences / explicitly out of scope:** no password reset or email
  verification yet (flagged, not built); the pseudonymous flow isn't deleted
  (cleanup deferred); self-signup patients aren't yet linked to the clinician
  register or to session creation (Part 2's job).

- [ ] **Step 3: Add superseded-by pointers to the three affected documents**

In ADR-012's file, add a note near the top (follow whatever "superseded"
convention existing ADRs in this repo use - check if any other ADR has already
been superseded and copy that exact pattern; if none has, add a short bolded
line under the title: `**Superseded in part by [ADR-019](019-patient-self-signup.md):** patients may now create a persistent self-signup account; see ADR-019 for what changed and what didn't.`).

In `docs/adr/017-patient-register.md`, find the line stating "Patient mode (no
clinician) never touches the register" (or equivalent) and add an adjacent note:
self-signup patient accounts (ADR-019) are a separate, parallel identity from
the clinician-only register this ADR describes - a self-signup patient has no
register entry (`nameEnc`/`dobEnc` are null) unless a clinician separately adds
one.

In `docs/consent-and-retention.md`'s "Subject identity" section, add a note next
to the "must stay pseudonymous" language: this governs the existing
`subjectPseudoId` flow; ADR-019 adds a separate, persistent patient-login
identity (email + password) alongside it, not a replacement.

- [ ] **Step 4: Run the claims linter**

```bash
npm run lint:claims
```
Expected: passes (this task only touches `docs/`, and `lint:claims` checks for
banned clinical-claim wording, not architecture content).

- [ ] **Step 5: Commit**

```bash
git add docs/adr docs/consent-and-retention.md
git commit -m "docs: add ADR-019, supersede ADR-012/017's no-subject-accounts posture

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: iOS - patient auth client and Keychain token store

**Files:**
- Create: `apps/ios-client/Sources/Auth/PatientAuthClient.swift`
- Create: `apps/ios-client/Sources/Identity/PatientSessionStore.swift`
- Test: `apps/ios-client/Tests/PatientAuthClientTests.swift` (new)
- Test: `apps/ios-client/Tests/PatientSessionStoreTests.swift` (new)

- [ ] **Step 1: Read the two files being mirrored first**

Read `apps/ios-client/Sources/Auth/ClinicianAuthClient.swift` and
`apps/ios-client/Sources/Identity/SubjectIdentityStore.swift` in full (both
already read during planning; re-read to confirm nothing's changed) - the new
files below copy their structure closely.

- [ ] **Step 2: Implement `PatientAuthClient`**

Create `apps/ios-client/Sources/Auth/PatientAuthClient.swift`:
```swift
import Foundation

/// POST /auth/patient/signup and /auth/patient/login
/// (services/backend-api/src/auth/patient-auth.controller.ts, ADR-019).
final class PatientAuthClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    /// Returns the patient JWT. Throws `.emailTaken` on 409, `.invalidInput` on 400.
    func signUp(email: String, password: String) async throws -> String {
        try await post(path: "auth/patient/signup", email: email, password: password)
    }

    /// Returns the patient JWT. Throws `.invalidCredentials` on 401.
    func signIn(email: String, password: String) async throws -> String {
        try await post(path: "auth/patient/login", email: email, password: password)
    }

    private func post(path: String, email: String, password: String) async throws -> String {
        var request = URLRequest(url: BackendConfig.baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(["email": email, "password": password])

        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        if status == 401 { throw PatientAuthError.invalidCredentials }
        if status == 409 { throw PatientAuthError.emailTaken }
        if status == 400 { throw PatientAuthError.invalidInput }
        guard (200..<300).contains(status) else { throw PatientAuthError.serverError(status) }
        struct Result: Decodable { let accessToken: String }
        return try JSONDecoder().decode(Result.self, from: data).accessToken
    }
}

enum PatientAuthError: Error {
    case invalidCredentials
    case emailTaken
    case invalidInput
    case serverError(Int)
}
```

- [ ] **Step 3: Implement `PatientSessionStore`**

Create `apps/ios-client/Sources/Identity/PatientSessionStore.swift`:
```swift
import Foundation

/// The signed-in patient's JWT, persisted in the Keychain so a returning user
/// skips straight past login (ADR-019). Separate from SubjectIdentityStore,
/// which stores the older pseudonymous per-session identity - the two aren't
/// interchangeable (a persistent login token vs. a random, unauthenticated id).
final class PatientSessionStore {
    private static let tokenKey = "patientAccessToken"
    private let store: SecretStore

    init(store: SecretStore = KeychainSecretStore()) {
        self.store = store
    }

    var token: String? { store.read(Self.tokenKey) }

    func save(token: String) {
        _ = store.write(Self.tokenKey, value: token)
    }

    func clear() {
        store.delete(Self.tokenKey)
    }
}
```
`SecretStore`/`KeychainSecretStore` are the existing protocol/implementation
already defined in `SubjectIdentityStore.swift` - don't redefine them, this file
just uses them. `KeychainSecretStore`'s `service` constant is currently hardcoded
to `"com.beaive.subject"` inside that type; check whether reusing it for patient
tokens under the same Keychain service namespace is acceptable (the `account`
key - `"patientAccessToken"` vs `"subjectPseudoId"`/`"consentRecordId"` - already
disambiguates entries within that service, so this is likely fine) or whether
`KeychainSecretStore` needs a `service` parameter added so `PatientSessionStore`
can use a distinct namespace (e.g. `"com.beaive.patient"`) - use your judgment,
but if you change `KeychainSecretStore`'s signature, re-check every existing call
site compiles (just `SubjectIdentityStore`).

- [ ] **Step 4: Tests**

Create `apps/ios-client/Tests/PatientSessionStoreTests.swift` with an in-memory
fake `SecretStore` (follow whatever fake `SubjectIdentityStoreTests.swift` uses,
if that file exists - check first) testing: starts with `token == nil`; `save`
then `token` returns the saved value; `clear` then `token` returns nil.

Create `apps/ios-client/Tests/PatientAuthClientTests.swift` using a
`URLProtocol`-stubbing approach if the test suite already has one for
`ClinicianAuthClient` (check for an existing `ClinicianAuthClientTests.swift` or
similar network-stubbing helper first and reuse its pattern exactly - don't
invent a new stubbing mechanism if one exists). Cover: a 200 response decodes
`accessToken`; 401 throws `.invalidCredentials`; 409 throws `.emailTaken`; 400
throws `.invalidInput`.

- [ ] **Step 5: Run the iOS test suite**

```bash
cd apps/ios-client
xcodebuild build -scheme PosturePulse -destination 'platform=iOS Simulator,name=iPhone 17' 2>&1 | tail -40
xcodebuild test -scheme PosturePulse -destination 'platform=iOS Simulator,name=iPhone 17' 2>&1 | tail -80
```
Expected: `BUILD SUCCEEDED`, all tests pass including the new ones.

- [ ] **Step 6: Commit**

```bash
git add apps/ios-client/Sources/Auth/PatientAuthClient.swift apps/ios-client/Sources/Identity/PatientSessionStore.swift apps/ios-client/Tests/PatientAuthClientTests.swift apps/ios-client/Tests/PatientSessionStoreTests.swift
git commit -m "feat: add iOS PatientAuthClient and Keychain-backed session store

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: iOS - account chooser, patient sign-up/sign-in screens, RootView wiring

**Files:**
- Create: `apps/ios-client/Sources/Auth/AccountChooserView.swift`
- Create: `apps/ios-client/Sources/Auth/PatientAuthView.swift`
- Modify: `apps/ios-client/Sources/App/RootView.swift`
- Modify: `apps/ios-client/Sources/App/BeAIveApp.swift`

- [ ] **Step 1: Read `RootView.swift` and `BeAIveApp.swift` in full first**

Both already read during planning; re-read to confirm the exact current `Step`
enum and `DesignPreview` cases before editing - this task changes `RootView`'s
entry step, which is load-bearing for the whole app.

- [ ] **Step 2: `AccountChooserView`**

Create `apps/ios-client/Sources/Auth/AccountChooserView.swift`. Two options,
`NeonTheme`-styled (matching `SplashView.swift`/`ModeChooserView.swift`'s visual
language, since this replaces `ModeChooserView` as the first screen after
splash):
```swift
import SwiftUI

/// Replaces the swipe mode-chooser as the first screen after splash
/// (ADR-019): a patient signs up/logs in with a persistent account, or a
/// clinician signs in with the existing clinician auth.
struct AccountChooserView: View {
    let onChoosePatient: () -> Void
    let onChooseClinic: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Text("POSTUREPULSE")
                .font(NeonTypo.heading)
                .tracking(1)
                .foregroundColor(NeonTheme.textPrimary)
            VStack(spacing: 16) {
                accountButton(title: "Patient", icon: "person.fill", action: onChoosePatient)
                accountButton(title: "Clinic", icon: "stethoscope", action: onChooseClinic)
            }
            .padding(.horizontal, 28)
            Spacer()
            Text("Results are camera-based estimates that a clinician reviews.")
                .font(.footnote)
                .foregroundColor(NeonTheme.textDim)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)
                .padding(.bottom, 18)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(NeonTheme.bgDeep.ignoresSafeArea())
    }

    private func accountButton(title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.title3.weight(.semibold))
                .foregroundColor(NeonTheme.textPrimary)
                .frame(maxWidth: .infinity, minHeight: 56)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NeonTheme.violet.opacity(0.5), lineWidth: 1))
        }
        .accessibilityHint("Starts \(title.lowercased()) sign-in")
    }
}
```
(Verify `NeonTheme`/`NeonTypo`'s exact member names against
`Sources/DesignSystem/NeonTheme.swift` before using them - adapt names if they
differ from this sketch.)

- [ ] **Step 3: `PatientAuthView`**

Create `apps/ios-client/Sources/Auth/PatientAuthView.swift` - a single view
toggling between sign-up and sign-in (read `ClinicianSignInView.swift` again for
the exact field/error/loading-state pattern to mirror, including the
`.textContentType`/`.autocorrectionDisabled` modifiers):
```swift
import SwiftUI

/// Patient sign-up/sign-in (ADR-019). Mirrors ClinicianSignInView's structure.
struct PatientAuthView: View {
    let onSignedIn: (_ token: String) -> Void
    let onBack: () -> Void

    private enum Mode { case signUp, signIn }

    @State private var mode: Mode = .signUp
    @State private var email = ""
    @State private var password = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private let client = PatientAuthClient()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Button(action: onBack) {
                    Label("Back", systemImage: "chevron.left").font(.subheadline.weight(.semibold))
                }
                .foregroundColor(NeonTheme.textPrimary)
                .padding(.top, 8)

                Picker("Mode", selection: $mode) {
                    Text("Sign up").tag(Mode.signUp)
                    Text("Sign in").tag(Mode.signIn)
                }
                .pickerStyle(.segmented)

                VStack(spacing: 12) {
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Divider()
                    SecureField("Password (12+ characters)", text: $password)
                        .textContentType(mode == .signUp ? .newPassword : .password)
                        .onSubmit(submit)
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 14).fill(Color.white.opacity(0.06)))

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundColor(NeonTheme.textPrimary)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12).fill(NeonTheme.violetDim.opacity(0.3)))
                }

                Button(action: submit) {
                    if isSubmitting { ProgressView().tint(.white) } else { Text(mode == .signUp ? "Create account" : "Sign in") }
                }
                .buttonStyle(.primary)
                .disabled(isSubmitting || email.isEmpty || password.isEmpty)
            }
            .padding(.horizontal, Theme.gutter)
            .padding(.bottom, 28)
        }
        .background(NeonTheme.bgDeep.ignoresSafeArea())
    }

    private func submit() {
        guard !email.isEmpty, !password.isEmpty, !isSubmitting else { return }
        isSubmitting = true
        errorMessage = nil
        Task {
            defer { isSubmitting = false }
            do {
                let token = mode == .signUp
                    ? try await client.signUp(email: email, password: password)
                    : try await client.signIn(email: email, password: password)
                password = ""
                onSignedIn(token)
            } catch PatientAuthError.invalidCredentials {
                errorMessage = "Email or password is not correct."
            } catch PatientAuthError.emailTaken {
                errorMessage = "An account with that email already exists. Try signing in instead."
            } catch PatientAuthError.invalidInput {
                errorMessage = "Check your email and make sure the password is at least 12 characters."
            } catch {
                errorMessage = "Could not reach the server. Check your connection and try again."
            }
        }
    }
}
```
This view uses `Theme.gutter` for horizontal padding (an existing shared layout
constant, not theme-specific) alongside `NeonTheme` colors - confirm `Theme.gutter`
is accessible without pulling in the rest of the light `Theme` palette; if the
codebase's convention is different, adjust to match it.

- [ ] **Step 4: Wire into `RootView`**

In `RootView.swift`'s `Step` enum, replace:
```swift
case chooseMode
```
with:
```swift
case chooseAccount
case patientAuth
```
Add new `@State` for the patient session:
```swift
@State private var patientToken: String?
private let patientSession = PatientSessionStore()
```
In `init`, restore a persisted token so a returning patient skips login:
```swift
init(identity: SubjectIdentityStore = SubjectIdentityStore()) {
    self.identity = identity
    _patientToken = State(initialValue: PatientSessionStore().token)
}
```
(Adjust if `init` already does other setup - read the current `init` again
before editing, shown above in this plan's research as a 3-line body.)

Replace the `.chooseMode` case's body:
```swift
case .chooseMode:
    ModeChooserView(
        onChoose: { chosen in ... },
        onViewResults: ...
    )
```
with:
```swift
case .chooseAccount:
    AccountChooserView(
        onChoosePatient: {
            mode = .patient
            if patientToken != nil {
                // Returning patient: skip straight into the existing flow this
                // part doesn't yet change (Part 2 wires the account in further).
                step = afterPatient
            } else {
                step = .patientAuth
            }
        },
        onChooseClinic: {
            mode = .clinic
            visitSubjectId = UUID().uuidString.lowercased()
            visitConsentRecordId = nil
            patient = nil
            step = clinicianToken == nil ? .clinicianSignIn : .pickPatient
        }
    )
case .patientAuth:
    PatientAuthView(
        onSignedIn: { token in
            patientToken = token
            patientSession.save(token: token)
            step = afterPatient
        },
        onBack: { step = .chooseAccount }
    )
```
Every other `step = .chooseMode` assignment elsewhere in the file (e.g.
`ModeChooserView`'s old `onViewResults`/the `.done`/`.results` cases' "back to
start" actions) becomes `step = .chooseAccount`. Find them with
`grep -n "\.chooseMode" Sources/App/RootView.swift` and update each one.

The initial `step` in `.splash`'s completion also changes:
```swift
case .splash:
    SplashView(onFinished: { step = .chooseAccount })
```

Note what this task deliberately does NOT change: once a patient or clinician
reaches `afterPatient`/`pickPatient`, the rest of the flow (`consent`,
`preparing`, `setup`, `battery`, `done`, `results`) is completely untouched -
patient login currently only gates entry into the *same* existing
pseudonymous-identity flow underneath. Wiring the real `Patient.id` into session
creation is explicitly Part 2's job, not this task's.

- [ ] **Step 5: Update `BeAIveApp.swift`'s `DesignPreview`**

Find the case(s) referencing `ModeChooserView` (`grep -n "ModeChooserView"
Sources/App/BeAIveApp.swift`). Add a new `.accountChooser` case alongside it
(don't remove the existing `ModeChooserView` preview case - the view and its
file aren't deleted in this part, just no longer reachable from `RootView`'s
default flow):
```swift
case accountChooser = "account-chooser"
```
and a matching switch branch:
```swift
case .accountChooser:
    AccountChooserView(onChoosePatient: {}, onChooseClinic: {})
```
Update the doc comment above the enum listing valid `-designPreview` values to
include the new case.

- [ ] **Step 6: Build and run the full test suite**

```bash
cd apps/ios-client
xcodebuild build -scheme PosturePulse -destination 'platform=iOS Simulator,name=iPhone 17' 2>&1 | tail -40
xcodebuild test -scheme PosturePulse -destination 'platform=iOS Simulator,name=iPhone 17' 2>&1 | tail -80
```
Expected: `BUILD SUCCEEDED`, all tests pass. If the simulator hangs for an
unusually long time, it's been flaky under concurrent runs this session -
reboot it once (`xcrun simctl shutdown A72CB760-2154-4B32-A7D7-A3E704FC3319 &&
xcrun simctl boot A72CB760-2154-4B32-A7D7-A3E704FC3319`) before concluding
something's actually broken, and don't run multiple `xcodebuild test`
invocations concurrently.

- [ ] **Step 7: Commit**

```bash
git add apps/ios-client/Sources/Auth/AccountChooserView.swift apps/ios-client/Sources/Auth/PatientAuthView.swift apps/ios-client/Sources/App/RootView.swift apps/ios-client/Sources/App/BeAIveApp.swift
git commit -m "feat: replace swipe mode-chooser with login-based account chooser

AccountChooserView is now the first screen after splash: Patient (sign up
or sign in, persistent account) or Clinic (existing clinician sign-in,
reused unchanged). ModeChooserView's file and its DesignPreview case are
left in place, just no longer reachable from RootView's default flow.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite**

```bash
cd services/backend-api
npx prisma generate
npx jest
npm run lint:claims
```
(`lint:claims` from repo root.) Expected: all pass.

- [ ] **Step 2: Full iOS suite**

```bash
cd apps/ios-client
xcodebuild test -scheme PosturePulse -destination 'platform=iOS Simulator,name=iPhone 17' 2>&1 | tail -80
```
Expected: all green, no regressions anywhere in the suite (not just the new files).

- [ ] **Step 3: Manual on-device check (required before calling this done)**

Build to the iPhone XR and confirm:
- Splash leads to the new account chooser, not the old swipe screen.
- "Patient" → sign up with a new email/password → lands past login (into the
  existing consent flow, since Part 2 hasn't wired further yet) without error.
- Force-quit and relaunch the app: the same patient is still signed in (no login
  prompt), confirming Keychain persistence works.
- "Clinic" → sign in as `dr.ben` (created earlier this session on the live
  server) → confirm the existing clinician flow (patient picker, etc.) still
  works exactly as before - this part must not have broken it.

Report the result back - this cannot be automated and is not optional per the
spec's own testing section.
