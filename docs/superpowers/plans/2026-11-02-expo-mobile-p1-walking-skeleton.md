# Expo Mobile Client — P1 Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clinician logs in on a real device, picks a patient, captures four poses with a full-bleed camera, uploads them, and sees real measurements returned by the production backend.

**Architecture:** A new Expo app at `apps/mobile`, joined to the existing npm workspaces so it imports types from `@beaive/schemas`. It calls only endpoints that already exist on `https://posture.beaive.com` — no backend changes. Pose estimation is **not** in this project; the device contributes only per-frame gravity from its motion sensor, and every reported number comes from MediaPipe on the server.

**Tech Stack:** Expo SDK 54 + EAS custom dev build (Expo Go cannot run `react-native-vision-camera`), expo-router, react-native-vision-camera, expo-sensors, expo-secure-store, TypeScript, Jest (`jest-expo`).

**Design spec:** `docs/superpowers/specs/2026-11-02-expo-mobile-client-design.md`

---

## The actual installed stack

Task 1 scaffolded the app and the real versions differ from what this plan originally assumed. These are verified facts, not guesses:

- **Expo SDK 58**, React Native 0.88, React 19.3, TypeScript 6.0.
- **Routes live under `src/app/`**, not `app/` — that is the SDK 58 template layout, and the plan follows it rather than fighting it.
- **TypeScript 6 no longer auto-includes `@types/*`**, so `tsconfig.json` carries `"types": ["jest", "node"]`.
- **`react-native-vision-camera@5` is a complete Nitro rewrite.** v4 APIs are gone: there is no `useCameraFormat`, no static `Camera.requestCameraPermission()`, and no `camera.startRecording({...})` on a ref. v5 uses `useCameraPermission()`, `usePreviewOutput()`, `useVideoOutput()`, and `videoOutput.createRecorder()` returning a `Recorder` with `startRecording(onFinished, onError)`, `stopRecording()` and a live `recordedDuration`. v5 also ships no Expo config plugin, so the camera permission is declared directly via `ios.infoPlist.NSCameraUsageDescription` and `android.permissions` in `app.json`.

The app's own `apps/mobile/AGENTS.md` warns against trusting training data for Expo and React Native APIs. **That warning is correct and applies to the code in this plan.** If a snippet here does not typecheck, read the installed `.d.ts` files under `node_modules/` and fix the code to match — never reach for `any`, `@ts-ignore`, or a loosened `tsconfig.json`.

## Before you start

Read the spec above, then these three rules from `CLAUDE.md`, which this plan enforces in code:

1. **Never fabricate a measurement.** If gravity samples are missing, the sidecar builder throws — it must never emit zeros. Task 8 tests this.
2. **Track provenance.** Every `ClipCapture` carries a `provenance` block. Task 8.
3. **Never imply diagnosis.** The word `diagnos` anywhere in `.tsx` fails `npm run lint:claims`. Task 11's animation copy is written to pass.

### Verified API contracts

These were read from the running backend. Do not guess at them.

| Endpoint | Auth | Shape |
|---|---|---|
| `POST /auth/login` | none | `{username, password}` → `{accessToken}` |
| `GET /patients?q=` | clinician JWT | → `PatientRecord[]` (`{id, name, dateOfBirth, contact?, createdAt?}`) |
| `POST /patients` | clinician JWT | `{name, dateOfBirth, contact?}` → `PatientRecord` |
| `POST /patients/:patientId/link` | clinician JWT | links a visit pseudo-id to a patient |
| `POST /consent-records` | none | `{subjectPseudoId, scopes}` → consent record with `consentRecordId` |
| `GET /assessment-battery` | none | → `{version, status, steps[]}` |
| `POST /sessions` | none | `CreateSessionInput` → `{session, sessionToken}` |
| `PUT /sessions/:id/clips/:stepId` | **session token** | multipart `clip` + `sidecar` → `{clipId, status}` |
| `GET /sessions/:sessionId/events` | clinician JWT | → full event log |

**Two tokens, and mixing them up is the most likely bug in this project:**

- **Clinician JWT** — login, patients, events.
- **Session token** — returned by `POST /sessions`, used *only* for clip upload. `SessionOwnershipGuard` requires `role === "subject"` for that exact session id and **rejects clinician tokens with 403**.

`metric-result` is **not** a WebSocket event. Results come from polling the events endpoint.

---

## File structure

```
apps/mobile/
├── app.json                      Expo config: name, plugins, iOS/Android permissions
├── eas.json                      EAS build profiles (development/preview/production)
├── metro.config.js               monorepo resolution — REQUIRED for workspace imports
├── package.json
├── tsconfig.json
├── jest.config.js
└── src/
    ├── app/                      expo-router routes (one file per screen)
    │   ├── _layout.tsx           root layout + auth gate
    │   ├── index.tsx             redirects to login or home
    │   ├── login.tsx
    │   ├── permissions.tsx
    │   ├── home.tsx
    │   ├── patient.tsx
    │   ├── consent.tsx
    │   ├── capture.tsx
    │   ├── analysis.tsx
    │   └── results.tsx
    ├── api/
    │   ├── config.ts             base URL
    │   ├── http.ts               fetch wrapper, typed errors, token injection
    │   ├── auth.ts               login
    │   ├── patients.ts           search / create / link
    │   ├── sessions.ts           consent + session creation + battery
    │   ├── clips.ts              multipart upload
    │   └── events.ts             poll for metric-result
    ├── auth/
    │   ├── tokenStore.ts         expo-secure-store wrapper (both tokens)
    │   └── AuthContext.tsx       session state for the app
    ├── capture/
    │   ├── poses.ts              the four pose definitions
    │   ├── gravity.ts            DeviceMotion → unit gravity in camera frame
    │   └── sidecar.ts            ClipCapture construction (pure, heavily tested)
    └── components/
        └── AnalysisStages.tsx    the six-stage animation
```

**Why this split:** `src/capture/sidecar.ts` and `src/capture/gravity.ts` are pure functions with no React or native dependencies, so they can be unit-tested properly. Everything native lives in screens. The API layer is one file per resource so each stays small.

---

## Task 1: Scaffold the Expo app in the workspace

**Files:**
- Create: `apps/mobile/` (via CLI)
- Create: `apps/mobile/metro.config.js`
- Modify: `package.json` (root `workspaces` array)

- [ ] **Step 1: Create the app**

```bash
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1/apps
npx create-expo-app@latest mobile --template default
```

- [ ] **Step 2: Add it to the workspace**

In the root `package.json`, change the `workspaces` array to:

```json
"workspaces": ["packages/schemas", "services/backend-api", "apps/clinician-web", "apps/mobile"]
```

- [ ] **Step 3: Configure Metro for the monorepo**

Without this, `import ... from "@beaive/schemas"` fails at runtime — Metro does not follow workspace symlinks by default.

Create `apps/mobile/metro.config.js`:

```js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch the whole monorepo so changes in packages/schemas are picked up.
config.watchFolders = [workspaceRoot];
// Resolve from the app first, then the hoisted root node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
```

- [ ] **Step 4: Install dependencies**

```bash
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1
npm install
cd apps/mobile
npx expo install react-native-vision-camera expo-sensors expo-secure-store expo-router expo-haptics
npm install --save-dev jest jest-expo @testing-library/react-native
```

- [ ] **Step 5: Declare permissions and the camera plugin**

In `apps/mobile/app.json`, inside `expo`, add:

```json
"plugins": [
  "expo-router",
  ["react-native-vision-camera", {
    "cameraPermissionText": "beAIve needs the camera to record the assessment poses.",
    "enableMicrophonePermission": false
  }]
],
"ios": { "supportsTablet": true, "bundleIdentifier": "com.beaive.mobile" },
"android": { "package": "com.beaive.mobile" }
```

- [ ] **Step 6: Configure Jest**

Create `apps/mobile/jest.config.js`:

```js
module.exports = {
  preset: "jest-expo",
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
};
```

Add to `apps/mobile/package.json` scripts: `"test": "jest"`.

- [ ] **Step 7: Verify it builds**

```bash
cd apps/mobile && npx tsc --noEmit
```
Expected: no output (success).

- [ ] **Step 8: Commit**

```bash
git add apps/mobile package.json package-lock.json
git commit -m "feat(mobile): scaffold Expo app in the workspace"
```

---

## Task 2: HTTP client

**Files:**
- Create: `apps/mobile/src/api/config.ts`
- Create: `apps/mobile/src/api/http.ts`
- Test: `apps/mobile/src/api/http.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/api/http.test.ts`:

```ts
import { UnauthorizedError, request, setUnauthorizedHandler } from "./http";

describe("request", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    setUnauthorizedHandler(null);
  });

  it("returns parsed JSON on success", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ id: "p-1" }),
    }) as unknown as typeof fetch;

    await expect(request<{ id: string }>("/patients")).resolves.toEqual({ id: "p-1" });
  });

  it("sends the bearer token when given one", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await request("/patients", { token: "tok-123" });

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer tok-123");
  });

  it("throws UnauthorizedError on 401 and notifies the handler", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 401, statusText: "Unauthorized", json: async () => ({}),
    }) as unknown as typeof fetch;
    const onUnauthorized = jest.fn();
    setUnauthorizedHandler(onUnauthorized);

    await expect(request("/patients")).rejects.toBeInstanceOf(UnauthorizedError);
    // An expired token must not linger, or every later screen retries with it.
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("surfaces the server's message rather than a generic failure", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 403, statusText: "Forbidden",
      json: async () => ({ message: "Token is not valid for this session." }),
    }) as unknown as typeof fetch;

    await expect(request("/sessions/s-1/clips/front")).rejects.toThrow(
      "Token is not valid for this session."
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest src/api/http.test.ts
```
Expected: FAIL — `Cannot find module './http'`.

- [ ] **Step 3: Implement**

Create `apps/mobile/src/api/config.ts`:

```ts
/** Overridable per build via EXPO_PUBLIC_BACKEND_URL; defaults to production. */
export const BACKEND_URL: string =
  process.env.EXPO_PUBLIC_BACKEND_URL ?? "https://posture.beaive.com";
```

Create `apps/mobile/src/api/http.ts`:

```ts
import { BACKEND_URL } from "./config";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** 401 is separate so the caller can clear the stored token and return to login. */
export class UnauthorizedError extends ApiError {
  constructor() {
    super("Your session has expired - please log in again.", 401);
  }
}

/**
 * Called on any 401. The app wires this to clearing the keychain, so an
 * expired token is dropped once rather than retried by every later screen.
 * Kept as a handler so this module stays free of storage dependencies.
 */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
}

async function serverMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body?.message === "string") return body.message;
    if (Array.isArray(body?.message)) return body.message.join("; ");
  } catch {
    // No JSON body - the status line is all there is.
  }
  return response.statusText;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  await assertOk(response);
  return (await response.json()) as T;
}

/**
 * Shared failure handling for every call, including the multipart clip upload
 * which cannot go through `request()` because it sends FormData.
 */
export async function assertOk(response: Response): Promise<void> {
  if (response.status === 401) {
    unauthorizedHandler?.();
    throw new UnauthorizedError();
  }
  if (!response.ok) throw new ApiError(await serverMessage(response), response.status);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/mobile && npx jest src/api/http.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/api
git commit -m "feat(mobile): add HTTP client with typed errors"
```

---

## Task 3: Token store

Both tokens live in the device keychain. Keeping them in one module makes it hard to send the wrong one.

**Files:**
- Create: `apps/mobile/src/auth/tokenStore.ts`
- Test: `apps/mobile/src/auth/tokenStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/auth/tokenStore.test.ts`:

```ts
import * as SecureStore from "expo-secure-store";
import { clearClinicianToken, getClinicianToken, saveClinicianToken } from "./tokenStore";

jest.mock("expo-secure-store");

describe("tokenStore", () => {
  afterEach(() => jest.resetAllMocks());

  it("saves the clinician token under its own key", async () => {
    await saveClinicianToken("tok-abc");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("beaive.clinicianToken", "tok-abc");
  });

  it("reads the clinician token back", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("tok-abc");
    await expect(getClinicianToken()).resolves.toBe("tok-abc");
  });

  it("returns null rather than throwing when the keychain is unavailable", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error("keychain locked"));
    await expect(getClinicianToken()).resolves.toBeNull();
  });

  it("clears the token on logout", async () => {
    await clearClinicianToken();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("beaive.clinicianToken");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest src/auth/tokenStore.test.ts
```
Expected: FAIL — `Cannot find module './tokenStore'`.

- [ ] **Step 3: Implement**

Create `apps/mobile/src/auth/tokenStore.ts`:

```ts
import * as SecureStore from "expo-secure-store";

const CLINICIAN_KEY = "beaive.clinicianToken";

/**
 * The clinician JWT authorises /patients, /sessions and the events log. It is
 * NOT accepted for clip upload - that needs the per-session subject token
 * returned by POST /sessions, which lives only in memory for the duration of
 * a scan and is deliberately never persisted.
 */
export async function saveClinicianToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(CLINICIAN_KEY, token);
}

export async function getClinicianToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(CLINICIAN_KEY);
  } catch {
    // A locked or unavailable keychain means "not logged in", not a crash.
    return null;
  }
}

export async function clearClinicianToken(): Promise<void> {
  await SecureStore.deleteItemAsync(CLINICIAN_KEY);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/mobile && npx jest src/auth/tokenStore.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/auth
git commit -m "feat(mobile): store the clinician token in the keychain"
```

---

## Task 4: Login

**Files:**
- Create: `apps/mobile/src/api/auth.ts`
- Create: `apps/mobile/src/app/login.tsx`
- Test: `apps/mobile/src/api/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/api/auth.test.ts`:

```ts
import { login } from "./auth";

describe("login", () => {
  afterEach(() => jest.restoreAllMocks());

  it("posts credentials and returns the access token", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ accessToken: "jwt-1" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(login("dr.ben", "pw")).resolves.toBe("jwt-1");
    expect(fetchMock.mock.calls[0][0]).toContain("/auth/login");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      username: "dr.ben", password: "pw",
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest src/api/auth.test.ts
```
Expected: FAIL — `Cannot find module './auth'`.

- [ ] **Step 3: Implement the API call**

Create `apps/mobile/src/api/auth.ts`:

```ts
import { request } from "./http";

export async function login(username: string, password: string): Promise<string> {
  const result = await request<{ accessToken: string }>("/auth/login", {
    method: "POST",
    body: { username, password },
  });
  return result.accessToken;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/mobile && npx jest src/api/auth.test.ts
```
Expected: PASS, 1 test.

- [ ] **Step 5: Build the login screen**

Create `apps/mobile/src/app/login.tsx`:

```tsx
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { login } from "../api/auth";
import { saveClinicianToken } from "../auth/tokenStore";

export default function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy || !username || !password) return;
    setBusy(true);
    setError(null);
    try {
      await saveClinicianToken(await login(username, password));
      router.replace("/permissions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>beAIve</Text>
      <Text style={styles.subtitle}>Clinician sign in</Text>

      <TextInput
        style={styles.input}
        placeholder="Username"
        placeholderTextColor="#9d93ae"
        autoCapitalize="none"
        autoCorrect={false}
        value={username}
        onChangeText={setUsername}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#9d93ae"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.button} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#0e0a16" /> : <Text style={styles.buttonText}>Sign in</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0e0a16", padding: 28, justifyContent: "center" },
  title: { color: "#efeaf6", fontSize: 34, fontWeight: "800" },
  subtitle: { color: "#9d93ae", fontSize: 15, marginBottom: 28 },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)", color: "#efeaf6",
    borderRadius: 12, padding: 16, marginBottom: 12, fontSize: 16,
  },
  error: { color: "#ff6b6b", marginBottom: 12 },
  button: {
    backgroundColor: "#b98cff", borderRadius: 12, padding: 17,
    alignItems: "center", marginTop: 8,
  },
  buttonText: { color: "#0e0a16", fontWeight: "700", fontSize: 16 },
});
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/api/auth.ts apps/mobile/src/api/auth.test.ts apps/mobile/src/app/login.tsx
git commit -m "feat(mobile): add clinician login"
```

---

## Task 5: Permissions screen

**Files:**
- Create: `apps/mobile/src/app/permissions.tsx`

- [ ] **Step 1: Build the screen**

Create `apps/mobile/src/app/permissions.tsx`:

```tsx
import { router } from "expo-router";
import { useEffect } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useCameraPermission } from "react-native-vision-camera";

export default function PermissionsScreen() {
  // vision-camera v5 exposes permissions as a reactive hook rather than the
  // static Camera.requestCameraPermission() of v4.
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();

  useEffect(() => {
    if (hasPermission) router.replace("/home");
  }, [hasPermission]);

  // Permission permanently denied: requesting again is a no-op, so send the
  // clinician to Settings rather than a button that silently does nothing.
  const mustUseSettings = !hasPermission && !canRequestPermission;

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Camera access</Text>
      <Text style={styles.body}>
        beAIve records short video clips of each assessment pose. The clips are uploaded to your
        clinic's server for measurement and are never shared elsewhere.
      </Text>
      {mustUseSettings && (
        <Text style={styles.denied}>
          Camera access was denied. Enable it in Settings to run an assessment.
        </Text>
      )}
      <Pressable
        style={styles.button}
        onPress={() => (mustUseSettings ? Linking.openSettings() : requestPermission())}
      >
        <Text style={styles.buttonText}>{mustUseSettings ? "Open Settings" : "Allow camera"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0e0a16", padding: 28, justifyContent: "center" },
  title: { color: "#efeaf6", fontSize: 26, fontWeight: "800", marginBottom: 12 },
  body: { color: "#9d93ae", fontSize: 15, lineHeight: 22, marginBottom: 24 },
  denied: { color: "#ff6b6b", marginBottom: 16 },
  button: { backgroundColor: "#b98cff", borderRadius: 12, padding: 17, alignItems: "center" },
  buttonText: { color: "#0e0a16", fontWeight: "700", fontSize: 16 },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/app/permissions.tsx
git commit -m "feat(mobile): add camera permission screen"
```

---

## Task 6: Patient picker

**Files:**
- Create: `apps/mobile/src/api/patients.ts`
- Create: `apps/mobile/src/app/patient.tsx`
- Test: `apps/mobile/src/api/patients.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/api/patients.test.ts`:

```ts
import { createPatient, linkPatient, searchPatients } from "./patients";

describe("patients api", () => {
  afterEach(() => jest.restoreAllMocks());

  it("url-encodes the search query", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    global.fetch = fetchMock as unknown as typeof fetch;

    await searchPatients("de souza", "tok");

    expect(fetchMock.mock.calls[0][0]).toContain("/patients?q=de%20souza");
  });

  it("sends the clinician token when creating a patient", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ id: "p-9" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await createPatient({ name: "R Kumar", dateOfBirth: "1984-02-11" }, "tok");

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("links a visit pseudo-id to the patient record", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await linkPatient("p-9", "subj-1", "tok");

    expect(fetchMock.mock.calls[0][0]).toContain("/patients/p-9/link");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest src/api/patients.test.ts
```
Expected: FAIL — `Cannot find module './patients'`.

- [ ] **Step 3: Implement**

Create `apps/mobile/src/api/patients.ts`:

```ts
import { request } from "./http";

/**
 * Identifying fields are decrypted by backend-api for this response only
 * (ADR-017). They must never be written into an event, a session record or a
 * report body - the visit is identified by its pseudonymous subject id.
 */
export interface PatientRecord {
  id: string;
  name: string;
  dateOfBirth: string;
  contact?: string | null;
  createdAt?: string;
}

export interface NewPatient {
  name: string;
  dateOfBirth: string;
  contact?: string;
}

export function searchPatients(query: string, token: string): Promise<PatientRecord[]> {
  return request<PatientRecord[]>(`/patients?q=${encodeURIComponent(query)}`, { token });
}

export function createPatient(patient: NewPatient, token: string): Promise<PatientRecord> {
  return request<PatientRecord>("/patients", { method: "POST", body: patient, token });
}

/** Ties this visit's pseudonymous subject id to the patient record. */
export function linkPatient(
  patientId: string,
  subjectPseudoId: string,
  token: string
): Promise<unknown> {
  return request(`/patients/${encodeURIComponent(patientId)}/link`, {
    method: "POST",
    body: { subjectPseudoId },
    token,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/mobile && npx jest src/api/patients.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Build the picker screen**

Create `apps/mobile/src/app/patient.tsx`:

```tsx
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { PatientRecord, searchPatients } from "../api/patients";
import { getClinicianToken } from "../auth/tokenStore";

export default function PatientPickerScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const token = await getClinicianToken();
        if (!token) return router.replace("/login");
        const found = await searchPatients(query.trim(), token);
        if (!cancelled) {
          setResults(found);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Search failed.");
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Who are you assessing?</Text>
      <TextInput
        style={styles.input}
        placeholder="Search by name"
        placeholderTextColor="#9d93ae"
        autoFocus
        value={query}
        onChangeText={setQuery}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={results}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() =>
              router.push({ pathname: "/consent", params: { patientId: item.id, patientName: item.name } })
            }
          >
            <Text style={styles.rowName}>{item.name}</Text>
            <Text style={styles.rowMeta}>{item.dateOfBirth}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          query.trim().length >= 2 ? <Text style={styles.empty}>No matching patient.</Text> : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0e0a16", padding: 20, paddingTop: 60 },
  title: { color: "#efeaf6", fontSize: 24, fontWeight: "800", marginBottom: 16 },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)", color: "#efeaf6",
    borderRadius: 12, padding: 15, fontSize: 16, marginBottom: 14,
  },
  error: { color: "#ff6b6b", marginBottom: 10 },
  row: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  rowName: { color: "#efeaf6", fontSize: 17, fontWeight: "600" },
  rowMeta: { color: "#9d93ae", fontSize: 13, marginTop: 2 },
  empty: { color: "#9d93ae", marginTop: 20 },
});
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/api/patients.ts apps/mobile/src/api/patients.test.ts apps/mobile/src/app/patient.tsx
git commit -m "feat(mobile): add patient search and picker"
```

---

## Task 7: Consent and session creation

**Files:**
- Create: `apps/mobile/src/api/sessions.ts`
- Create: `apps/mobile/src/app/consent.tsx`
- Test: `apps/mobile/src/api/sessions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/api/sessions.test.ts`:

```ts
import { createConsentRecord, createSession } from "./sessions";

describe("sessions api", () => {
  afterEach(() => jest.restoreAllMocks());

  it("requests the derived_events scope, without which session creation is refused", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ consentRecordId: "c-1" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await createConsentRecord("subj-1");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toContain("/consent-records");
    expect(body.scopes).toContain("derived_events");
  });

  it("does not request raw_video, because P1 does not retain raw video", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ consentRecordId: "c-1" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await createConsentRecord("subj-1");

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).scopes).not.toContain("raw_video");
  });

  it("creates a clinic_supervised session and returns both the session and its token", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ session: { id: "s-1" }, sessionToken: "subj-tok" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await createSession({
      subjectPseudoId: "subj-1", consentRecordId: "c-1", protocolVersion: "v0-draft",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.deploymentContext).toBe("clinic_supervised");
    expect(body.retentionPolicy.rawVideo.optIn).toBe(false);
    expect(result.sessionToken).toBe("subj-tok");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest src/api/sessions.test.ts
```
Expected: FAIL — `Cannot find module './sessions'`.

- [ ] **Step 3: Implement**

Create `apps/mobile/src/api/sessions.ts`:

```ts
import { request } from "./http";

export interface AssessmentBattery {
  version: string;
  status: string;
  steps: Array<{ stepId: string; title: string; view?: string }>;
}

export interface SessionCredentials {
  session: { id: string; state: string };
  /** Subject token - the ONLY token clip upload accepts. Never persisted. */
  sessionToken: string;
}

export function getAssessmentBattery(): Promise<AssessmentBattery> {
  return request<AssessmentBattery>("/assessment-battery");
}

/**
 * `derived_events` is mandatory: SessionsService refuses to create a session
 * without it. `raw_video` is deliberately not requested - P1 does not opt into
 * raw video retention, and asking for a scope we do not use would be wrong.
 */
export function createConsentRecord(subjectPseudoId: string): Promise<{ consentRecordId: string }> {
  return request<{ consentRecordId: string }>("/consent-records", {
    method: "POST",
    body: { subjectPseudoId, scopes: ["derived_events"] },
  });
}

export function createSession(input: {
  subjectPseudoId: string;
  consentRecordId: string;
  protocolVersion: string;
}): Promise<SessionCredentials> {
  return request<SessionCredentials>("/sessions", {
    method: "POST",
    body: {
      subjectPseudoId: input.subjectPseudoId,
      protocolId: "assessment-battery",
      protocolVersion: input.protocolVersion,
      deploymentContext: "clinic_supervised",
      consentRecordId: input.consentRecordId,
      retentionPolicy: {
        rawVideo: { optIn: false, retentionDays: null },
        derivedEvents: { retentionDays: 30 },
      },
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/mobile && npx jest src/api/sessions.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Build the consent screen**

The clinic runs on a shared device, so consent is per visit and a fresh pseudonymous id is generated each time (ADR-012).

Create `apps/mobile/src/app/consent.tsx`:

```tsx
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { linkPatient } from "../api/patients";
import { createConsentRecord, createSession, getAssessmentBattery } from "../api/sessions";
import { getClinicianToken } from "../auth/tokenStore";

export default function ConsentScreen() {
  const { patientId, patientName } = useLocalSearchParams<{ patientId: string; patientName: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function agree() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getClinicianToken();
      if (!token) return router.replace("/login");

      // A fresh pseudonymous id per visit - the clinic device is shared (ADR-012).
      const subjectPseudoId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const battery = await getAssessmentBattery();
      const consent = await createConsentRecord(subjectPseudoId);
      const credentials = await createSession({
        subjectPseudoId,
        consentRecordId: consent.consentRecordId,
        protocolVersion: battery.version,
      });
      await linkPatient(patientId, subjectPseudoId, token);

      router.replace({
        pathname: "/capture",
        params: {
          sessionId: credentials.session.id,
          sessionToken: credentials.sessionToken,
          patientName,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the assessment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Consent</Text>
      <Text style={styles.name}>{patientName}</Text>
      <Text style={styles.body}>
        Short video clips of four standing poses will be recorded and uploaded to this clinic's
        server, where body landmarks are measured. Video is not retained after measurement.
        Measurements are camera-based estimates reviewed by a clinician, and are not a substitute
        for clinical examination.
      </Text>
      <Text style={styles.body}>
        The recording can be stopped at any time, and the assessment can be ended on request.
      </Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={agree} disabled={busy}>
        {busy ? <ActivityIndicator color="#0e0a16" /> : <Text style={styles.buttonText}>Consent given — begin</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0e0a16" },
  content: { padding: 24, paddingTop: 60 },
  title: { color: "#efeaf6", fontSize: 26, fontWeight: "800" },
  name: { color: "#b98cff", fontSize: 16, marginTop: 4, marginBottom: 20 },
  body: { color: "#9d93ae", fontSize: 15, lineHeight: 23, marginBottom: 16 },
  error: { color: "#ff6b6b", marginBottom: 12 },
  button: { backgroundColor: "#b98cff", borderRadius: 12, padding: 17, alignItems: "center", marginTop: 12 },
  buttonText: { color: "#0e0a16", fontWeight: "700", fontSize: 16 },
});
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/api/sessions.ts apps/mobile/src/api/sessions.test.ts apps/mobile/src/app/consent.tsx
git commit -m "feat(mobile): add per-visit consent and session creation"
```

---

## Task 8: Gravity sampling and the ClipCapture sidecar

This is the most important task in the project. The sidecar is what lets the server know which way is down; get it wrong and every angle is wrong — and wrong in a way no test will catch, because the numbers still look plausible. Both files are pure functions so they can be tested properly.

**Verified against the installed `expo-sensors@58.0.4`:**

- `DeviceMotion` and the `DeviceMotionMeasurement` type are both exported from the package root, so the import below is correct.
- `accelerationIncludingGravity` is `{x, y, z}` in m/s² and is **not** nullable.
- `acceleration` (linear, gravity removed) **is** nullable — it is `null` when the device cannot separate the two. The code below falls back to zeros, which means gravity then includes linear motion. For a subject standing still that is harmless; it is also why the sampler must not be trusted during vigorous movement.
- Units do not matter, because every vector is normalised to unit length.

**The axis mapping is the part to be suspicious of.** Expo reports device axes (x right, y up, z out of the screen toward the viewer). The schema wants camera frame C (x image-right, y image-down, z along the optical axis away from the camera), so for a portrait back-camera shot y and z are negated. An upright, level phone should then produce approximately `[0, 1, 0]` — which is exactly the sanity check `clip-capture.schema.json` documents, and exactly what Task 13 Step 2 verifies on a real device. Do not treat this as settled until that check passes on hardware.

**Files:**
- Create: `apps/mobile/src/capture/gravity.ts`
- Create: `apps/mobile/src/capture/sidecar.ts`
- Test: `apps/mobile/src/capture/sidecar.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/capture/sidecar.test.ts`:

```ts
import { buildSidecar, MissingGravityError } from "./sidecar";

const device = { model: "iPhone16,1", lens: "back_wide" as const, appVersion: "1.0.0" };

const base = {
  clipId: "clip-1",
  sessionId: "s-1",
  stepId: "static.anterior",
  view: "anterior",
  recordedAt: "2026-11-02T10:00:00.000Z",
  fps: 30,
  width: 1080,
  height: 1920,
  durationSeconds: 2,
  device,
};

describe("buildSidecar", () => {
  it("emits one frame per encoded frame, derived from real duration and fps", () => {
    const sidecar = buildSidecar({
      ...base,
      gravitySamples: [{ t: 0, g: [0, 1, 0] }, { t: 2, g: [0, 1, 0] }],
    });
    expect(sidecar.frames).toHaveLength(60);
    expect(sidecar.frames[0].index).toBe(0);
    expect(sidecar.frames[59].index).toBe(59);
  });

  it("interpolates gravity between samples", () => {
    const sidecar = buildSidecar({
      ...base, durationSeconds: 1, fps: 3,
      gravitySamples: [{ t: 0, g: [0, 1, 0] }, { t: 1, g: [1, 0, 0] }],
    });
    // Frame 1 is at t = 1/3, so the raw lerp is [0.3333, 0.6667, 0] — which is
    // then normalised to unit length, giving [0.4472, 0.8944, 0].
    const [x, y] = sidecar.frames[1].gravity;
    expect(x).toBeCloseTo(0.4472, 3);
    expect(y).toBeCloseTo(0.8944, 3);
  });

  it("returns unit vectors, because the schema specifies a unit gravity direction", () => {
    const sidecar = buildSidecar({
      ...base, durationSeconds: 1, fps: 2,
      gravitySamples: [{ t: 0, g: [0, 9.81, 0] }, { t: 1, g: [0, 9.81, 0] }],
    });
    for (const frame of sidecar.frames) {
      const [x, y, z] = frame.gravity;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
    }
  });

  it("holds the first and last samples rather than extrapolating past them", () => {
    const sidecar = buildSidecar({
      ...base, durationSeconds: 1, fps: 2,
      gravitySamples: [{ t: 0.4, g: [0, 1, 0] }, { t: 0.6, g: [0, 1, 0] }],
    });
    expect(sidecar.frames[0].gravity).toEqual([0, 1, 0]);
    expect(sidecar.frames[1].gravity).toEqual([0, 1, 0]);
  });

  it("throws rather than emitting zeros when no gravity was captured", () => {
    expect(() => buildSidecar({ ...base, gravitySamples: [] })).toThrow(MissingGravityError);
  });

  it("carries a provenance block with every required field", () => {
    const sidecar = buildSidecar({
      ...base, gravitySamples: [{ t: 0, g: [0, 1, 0] }],
    });
    expect(sidecar.provenance.schemaVersion).toBe("clip-capture/v0");
    expect(sidecar.provenance.modelVersion).toContain("beaive-mobile");
    expect(sidecar.provenance.calibrationVersion).toBe("none/v0");
    expect(Number.isNaN(Date.parse(sidecar.provenance.producedAt))).toBe(false);
  });

  it("always produces at least one frame for a very short clip", () => {
    const sidecar = buildSidecar({
      ...base, durationSeconds: 0.01, fps: 30,
      gravitySamples: [{ t: 0, g: [0, 1, 0] }],
    });
    expect(sidecar.frames.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest src/capture/sidecar.test.ts
```
Expected: FAIL — `Cannot find module './sidecar'`.

- [ ] **Step 3: Implement the gravity sampler**

Create `apps/mobile/src/capture/gravity.ts`:

```ts
import { DeviceMotion, DeviceMotionMeasurement } from "expo-sensors";

export type Vector3 = [number, number, number];

export interface GravitySample {
  /** Seconds since recording started. */
  t: number;
  g: Vector3;
}

/**
 * Converts a device-motion reading into the unit gravity direction in camera
 * frame C, which clip-capture.schema.json defines as x = image right,
 * y = image down, z = optical axis away from the camera.
 *
 * Device axes (portrait, back camera) are x = right, y = up, z = out of the
 * screen toward the viewer, so image-down is -y and the back-camera optical
 * axis is -z. A level phone filming upright therefore yields approximately
 * [0, 1, 0], which is the sanity check the schema itself documents - verify it
 * on a real device before trusting any measurement (Task 13).
 */
export function toCameraFrameGravity(m: DeviceMotionMeasurement): Vector3 | null {
  const withGravity = m.accelerationIncludingGravity;
  if (!withGravity) return null;
  const linear = m.acceleration ?? { x: 0, y: 0, z: 0 };
  // Removing linear acceleration leaves gravity alone, so a moving phone
  // still reports which way is down.
  const gx = withGravity.x - linear.x;
  const gy = withGravity.y - linear.y;
  const gz = withGravity.z - linear.z;
  const magnitude = Math.hypot(gx, gy, gz);
  if (magnitude < 1e-6) return null;
  return [gx / magnitude, -gy / magnitude, -gz / magnitude];
}

/**
 * Samples gravity for the duration of a recording. Returns a stop function
 * that yields the samples collected, timestamped from the moment sampling
 * began.
 */
export function startGravitySampling(intervalMs = 16): () => GravitySample[] {
  const samples: GravitySample[] = [];
  const startedAt = Date.now();

  DeviceMotion.setUpdateInterval(intervalMs);
  const subscription = DeviceMotion.addListener((measurement) => {
    const g = toCameraFrameGravity(measurement);
    if (g) samples.push({ t: (Date.now() - startedAt) / 1000, g });
  });

  return () => {
    subscription.remove();
    return samples;
  };
}
```

- [ ] **Step 4: Implement the sidecar builder**

Create `apps/mobile/src/capture/sidecar.ts`:

```ts
import type { GravitySample, Vector3 } from "./gravity";

export const APP_VERSION = "1.0.0";
const MODEL_VERSION = `beaive-mobile/${APP_VERSION}`;

/**
 * Thrown when a clip was recorded without any usable gravity reading.
 * CLAUDE.md rule 3: never fabricate a measurement. A sidecar full of zeros
 * would tell the server the phone was in free fall, silently corrupting every
 * angle - so the upload must fail loudly instead.
 */
export class MissingGravityError extends Error {
  constructor() {
    super("No gravity readings were captured for this clip; it cannot be uploaded.");
  }
}

export interface ClipCapture {
  clipId: string;
  sessionId: string;
  stepId: string;
  view: string;
  recordedAt: string;
  nominalFps: number;
  width: number;
  height: number;
  frames: Array<{ index: number; t: number; gravity: Vector3 }>;
  device: { model: string; lens: "back_wide" | "back_ultrawide" | "front"; appVersion: string };
  provenance: {
    schemaVersion: string;
    modelVersion: string;
    calibrationVersion: string;
    producedAt: string;
  };
}

export interface BuildSidecarInput {
  clipId: string;
  sessionId: string;
  stepId: string;
  view: string;
  recordedAt: string;
  fps: number;
  width: number;
  height: number;
  durationSeconds: number;
  gravitySamples: GravitySample[];
  device: ClipCapture["device"];
}

function normalise(v: Vector3): Vector3 {
  const magnitude = Math.hypot(v[0], v[1], v[2]);
  if (magnitude < 1e-9) throw new MissingGravityError();
  return [v[0] / magnitude, v[1] / magnitude, v[2] / magnitude];
}

/** Linear interpolation between the two samples bracketing `t`, clamped at both ends. */
function gravityAt(samples: GravitySample[], t: number): Vector3 {
  if (t <= samples[0].t) return normalise(samples[0].g);
  const last = samples[samples.length - 1];
  if (t >= last.t) return normalise(last.g);

  for (let i = 1; i < samples.length; i += 1) {
    const b = samples[i];
    if (b.t < t) continue;
    const a = samples[i - 1];
    const span = b.t - a.t;
    const ratio = span <= 0 ? 0 : (t - a.t) / span;
    return normalise([
      a.g[0] + (b.g[0] - a.g[0]) * ratio,
      a.g[1] + (b.g[1] - a.g[1]) * ratio,
      a.g[2] + (b.g[2] - a.g[2]) * ratio,
    ]);
  }
  return normalise(last.g);
}

export function buildSidecar(input: BuildSidecarInput): ClipCapture {
  if (input.gravitySamples.length === 0) throw new MissingGravityError();

  // Frame count comes from the clip's real duration and frame rate - never a
  // fixed assumption, because recordings are rarely exactly the requested length.
  const frameCount = Math.max(1, Math.round(input.durationSeconds * input.fps));
  const frames = Array.from({ length: frameCount }, (_unused, index) => {
    const t = index / input.fps;
    return { index, t, gravity: gravityAt(input.gravitySamples, t) };
  });

  return {
    clipId: input.clipId,
    sessionId: input.sessionId,
    stepId: input.stepId,
    view: input.view,
    recordedAt: input.recordedAt,
    nominalFps: input.fps,
    width: input.width,
    height: input.height,
    frames,
    device: input.device,
    provenance: {
      schemaVersion: "clip-capture/v0",
      modelVersion: MODEL_VERSION,
      // No camera calibration is performed in P1; the server is told so
      // explicitly rather than left to infer it.
      calibrationVersion: "none/v0",
      producedAt: new Date().toISOString(),
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/mobile && npx jest src/capture/sidecar.test.ts
```
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/capture
git commit -m "feat(mobile): build ClipCapture sidecar from device gravity"
```

### Hardening added during implementation

Review of the first implementation found two ways to produce a **plausible but wrong** gravity vector — the worst failure mode here, because it passes schema validation and corrupts every derived angle without raising anything. Both are now guarded in `buildSidecar`:

1. **Samples are sorted by `t` before interpolating.** `gravityAt` assumes ascending order, and `Date.now()` can step backwards under an NTP adjustment. Out-of-order input would otherwise interpolate against the wrong neighbour. A regression test pins this, because the sort is defensive code that would otherwise be deleted silently.
2. **Sparse coverage is rejected.** For a clip longer than 1.5s, there must be at least two samples spanning at least half the duration. A single reading held across a whole recording is fabricated per-frame data — `CLAUDE.md` rule 3 — not a measurement.

### Known limitations, accepted for P1

- **Sampling starts a few hundred milliseconds before the first video frame**, so every frame's gravity carries a small constant time offset. Gravity is near-constant for a stationary standing pose, so this is negligible against the cost of aligning two clocks.
- **Frame count is `duration × fps`, not the true encoded frame count.** The server does not validate the two against each other, and these are fixed-rate clips. Variable frame rate would drift — a P2 concern.
- **The axis mapping is unproven until hardware.** Task 13 Step 2 is the only thing standing between a sign error and silently wrong measurements.

---

## Task 9: Capture screen

**Files:**
- Create: `apps/mobile/src/capture/poses.ts`
- Create: `apps/mobile/src/app/capture.tsx`

- [ ] **Step 1: Define the poses**

Create `apps/mobile/src/capture/poses.ts`:

```ts
export interface Pose {
  stepId: string;
  view: string;
  title: string;
  instruction: string;
}

/**
 * Step ids must match the assessment battery the server returns. They are
 * listed here so capture can run in a fixed order; the titles shown come from
 * the battery when it loads.
 */
export const POSES: Pose[] = [
  {
    stepId: "static.anterior",
    view: "anterior",
    title: "Facing the camera",
    instruction: "Stand facing the camera, feet hip-width apart, arms relaxed by your sides.",
  },
  {
    stepId: "static.left_lateral",
    view: "left_lateral",
    title: "Left side to camera",
    instruction: "Turn so your left side faces the camera. Look straight ahead, arms relaxed.",
  },
  {
    stepId: "static.right_lateral",
    view: "right_lateral",
    title: "Right side to camera",
    instruction: "Turn so your right side faces the camera. Look straight ahead, arms relaxed.",
  },
  {
    stepId: "static.posterior",
    view: "posterior",
    title: "Back to the camera",
    instruction: "Turn your back to the camera, feet hip-width apart, arms relaxed.",
  },
];

export const CLIP_SECONDS = 3;
```

- [ ] **Step 2: Build the capture screen**

The preview is `StyleSheet.absoluteFill` with no container padding — the subject fills the screen. The format is chosen to match the screen's aspect ratio so **what is framed is what is recorded**.

Create `apps/mobile/src/app/capture.tsx`:

```tsx
import * as Device from "expo-device";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  Camera,
  CommonResolutions,
  useCameraDevice,
  usePreviewOutput,
  useVideoOutput,
  type CameraSessionConfig,
} from "react-native-vision-camera";
import { uploadClip } from "../api/clips";
import { startGravitySampling } from "../capture/gravity";
import { CLIP_SECONDS, POSES } from "../capture/poses";
import { buildSidecar } from "../capture/sidecar";

// 1080x1920 - portrait, so the preview fills a tall phone screen and what is
// framed is what is recorded. A subject boxed into a letterboxed preview looks
// like a toy and gets framed wrong.
const TARGET_RESOLUTION = CommonResolutions.FHD_16_9;
const TARGET_FPS = 30;

export default function CaptureScreen() {
  const { sessionId, sessionToken } = useLocalSearchParams<{ sessionId: string; sessionToken: string }>();
  const [poseIndex, setPoseIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const device = useCameraDevice("back");
  const previewOutput = usePreviewOutput();
  const videoOutput = useVideoOutput({ targetResolution: TARGET_RESOLUTION, enableAudio: false });

  // The pipeline resolves constraints to a concrete config; the sidecar must
  // report the fps actually recorded, not the one we asked for.
  const actualFps = useRef(TARGET_FPS);
  const onSessionConfigSelected = useCallback((config: CameraSessionConfig) => {
    if (config.selectedFPS) actualFps.current = config.selectedFPS;
  }, []);

  const pose = POSES[poseIndex];

  async function record() {
    if (recording) return;
    setRecording(true);
    setError(null);

    const stopSampling = startGravitySampling();
    const recordedAt = new Date().toISOString();
    let lastDuration = 0;
    let durationTicker: ReturnType<typeof setInterval> | undefined;

    function cleanUp() {
      if (durationTicker) clearInterval(durationTicker);
      setRecording(false);
    }

    try {
      // maxDuration ends the recording itself, so there is no setTimeout race
      // between stopping and the file being finalised.
      const recorder = await videoOutput.createRecorder({ maxDuration: CLIP_SECONDS });

      // recordedDuration reads 0 once recording stops, so sample it while live
      // and keep the last value. The real duration drives the sidecar's frame
      // count - assuming CLIP_SECONDS would be a fabricated measurement.
      durationTicker = setInterval(() => {
        if (recorder.recordedDuration > 0) lastDuration = recorder.recordedDuration;
      }, 100);

      await recorder.startRecording(
        async (filePath) => {
          cleanUp();
          const gravitySamples = stopSampling();
          try {
            const sidecar = buildSidecar({
              clipId: `${sessionId}-${pose.stepId}`,
              sessionId,
              stepId: pose.stepId,
              view: pose.view,
              recordedAt,
              fps: actualFps.current,
              width: TARGET_RESOLUTION.width,
              height: TARGET_RESOLUTION.height,
              durationSeconds: lastDuration,
              gravitySamples,
              device: { model: Device.modelId ?? "unknown", lens: "back_wide", appVersion: "1.0.0" },
            });
            await uploadClip({ sessionId, stepId: pose.stepId, videoPath: filePath, sidecar, token: sessionToken });

            if (poseIndex + 1 < POSES.length) setPoseIndex(poseIndex + 1);
            else router.replace({ pathname: "/analysis", params: { sessionId } });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save that clip.");
          }
        },
        (err) => {
          cleanUp();
          stopSampling();
          setError(err.message);
        }
      );
    } catch (err) {
      cleanUp();
      stopSampling();
      setError(err instanceof Error ? err.message : "Could not start recording.");
    }
  }

  if (!device) return <View style={styles.screen}><Text style={styles.instruction}>No camera available.</Text></View>;

  return (
    <View style={styles.screen}>
      {/* absoluteFill with no padding: the subject fills the screen. */}
      <Camera
        style={StyleSheet.absoluteFill}
        isActive
        device={device}
        outputs={[previewOutput, videoOutput]}
        constraints={[{ fps: TARGET_FPS }]}
        onSessionConfigSelected={onSessionConfigSelected}
      />

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.header}>
          <Text style={styles.step}>Pose {poseIndex + 1} of {POSES.length}</Text>
          <Text style={styles.title}>{pose.title}</Text>
        </View>

        <View style={styles.footer}>
          <Text style={styles.instruction}>{pose.instruction}</Text>
          {error && (
            <>
              <Text style={styles.error}>{error}</Text>
              {/* Recovery in P1 is re-recording this pose; earlier poses are
                  already accepted server-side and are not re-uploaded. */}
              <Text style={styles.errorHint}>Press Start to record this pose again.</Text>
            </>
          )}
          <Pressable style={[styles.shutter, recording && styles.shutterActive]} onPress={record} disabled={recording}>
            <Text style={styles.shutterText}>{recording ? "Recording…" : "Start"}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: "space-between" },
  header: { paddingTop: 60, paddingHorizontal: 20 },
  step: { color: "#39ffc4", fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  title: { color: "#fff", fontSize: 24, fontWeight: "800", marginTop: 4 },
  footer: { padding: 20, paddingBottom: 44, backgroundColor: "rgba(14,10,22,0.55)" },
  instruction: { color: "#efeaf6", fontSize: 15, lineHeight: 22, marginBottom: 14 },
  error: { color: "#ff6b6b", marginBottom: 4 },
  errorHint: { color: "#9d93ae", fontSize: 13, marginBottom: 10 },
  shutter: { backgroundColor: "#b98cff", borderRadius: 14, padding: 18, alignItems: "center" },
  shutterActive: { backgroundColor: "#6e3fc9" },
  shutterText: { color: "#0e0a16", fontWeight: "800", fontSize: 16 },
});
```

- [ ] **Step 3: Confirm expo-device is present**

The screen uses `Device.modelId`, already imported above. `expo-device` ships with the template, so no install should be needed:

```bash
cd apps/mobile && node -e "console.log(require('./package.json').dependencies['expo-device'])"
```
Expected: a version string. If it prints `undefined`, run `npx expo install expo-device`.

- [ ] **Step 4: Typecheck**

```bash
cd apps/mobile && npx tsc --noEmit
```
Expected: no output. (`uploadClip` arrives in Task 10 — if this runs before Task 10, expect one unresolved-import error and continue.)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/capture/poses.ts apps/mobile/src/app/capture.tsx apps/mobile/package.json
git commit -m "feat(mobile): add full-bleed four-pose capture screen"
```

---

## Task 10: Clip upload

**Files:**
- Create: `apps/mobile/src/api/clips.ts`
- Test: `apps/mobile/src/api/clips.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/api/clips.test.ts`:

```ts
import { uploadClip } from "./clips";

const sidecar = { clipId: "c-1", sessionId: "s-1", stepId: "static.anterior" } as never;

describe("uploadClip", () => {
  afterEach(() => jest.restoreAllMocks());

  it("PUTs multipart to the step's clip route", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ clipId: "c-1", status: "accepted" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await uploadClip({
      sessionId: "s-1", stepId: "static.anterior",
      videoPath: "file:///tmp/clip.mov", sidecar, token: "subj-tok",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/sessions/s-1/clips/static.anterior");
    expect(init.method).toBe("PUT");
  });

  it("sends the session token, since a clinician token is rejected with 403", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ clipId: "c-1", status: "accepted" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await uploadClip({
      sessionId: "s-1", stepId: "static.anterior",
      videoPath: "file:///tmp/clip.mov", sidecar, token: "subj-tok",
    });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer subj-tok");
  });

  it("surfaces the server's rejection reason instead of dropping the clip silently", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 409, statusText: "Conflict",
      json: async () => ({ message: "This step already has an accepted clip." }),
    }) as unknown as typeof fetch;

    await expect(
      uploadClip({
        sessionId: "s-1", stepId: "static.anterior",
        videoPath: "file:///tmp/clip.mov", sidecar, token: "subj-tok",
      })
    ).rejects.toThrow("This step already has an accepted clip.");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest src/api/clips.test.ts
```
Expected: FAIL — `Cannot find module './clips'`.

- [ ] **Step 3: Implement**

Create `apps/mobile/src/api/clips.ts`:

```ts
import type { ClipCapture } from "../capture/sidecar";
import { assertOk } from "./http";
import { BACKEND_URL } from "./config";

/**
 * Multipart upload of one clip plus its ClipCapture sidecar.
 *
 * `token` must be the SESSION token returned by POST /sessions, not the
 * clinician JWT: SessionOwnershipGuard requires role === "subject" matching
 * this session id and answers 403 for anything else.
 */
export async function uploadClip(input: {
  sessionId: string;
  stepId: string;
  videoPath: string;
  sidecar: ClipCapture;
  token: string;
}): Promise<{ clipId: string; status: string }> {
  // iOS records .mov, Android always records .mp4 and ignores the recorder's
  // fileType option. Declare what was actually written rather than assuming:
  // the server accepts both, so a hardcoded type would be silently accepted
  // while storing a mislabelled file the analyser then fails to decode.
  const extension = input.videoPath.split(".").pop()?.toLowerCase() === "mp4" ? "mp4" : "mov";
  const contentType = extension === "mp4" ? "video/mp4" : "video/quicktime";

  const form = new FormData();
  form.append("clip", {
    uri: input.videoPath.startsWith("file://") ? input.videoPath : `file://${input.videoPath}`,
    name: `${input.stepId}.${extension}`,
    type: contentType,
  } as unknown as Blob);
  form.append("sidecar", JSON.stringify(input.sidecar));

  const response = await fetch(
    `${BACKEND_URL}/sessions/${encodeURIComponent(input.sessionId)}/clips/${encodeURIComponent(input.stepId)}`,
    {
      method: "PUT",
      // Content-Type is deliberately omitted: fetch must set the multipart
      // boundary itself, and setting it by hand breaks the upload.
      headers: { Authorization: `Bearer ${input.token}` },
      body: form,
    }
  );

  await assertOk(response);
  return (await response.json()) as { clipId: string; status: string };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/mobile && npx jest src/api/clips.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/api/clips.ts apps/mobile/src/api/clips.test.ts
git commit -m "feat(mobile): upload clips with the session token"
```

---

## Task 11: Analysis screen with the six-stage animation

Every stage label describes work the server actually does. The word `diagnos` must not appear — `npm run lint:claims` fails on it.

**Files:**
- Create: `apps/mobile/src/components/AnalysisStages.tsx`
- Create: `apps/mobile/src/app/analysis.tsx`

- [ ] **Step 1: Build the stages component**

Create `apps/mobile/src/components/AnalysisStages.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

/**
 * Six stages, each literally true of the server pipeline: upload, frame
 * extraction, landmark location, angle computation, quality gating, reference
 * comparison. Describing computation makes no clinical claim - and the copy
 * deliberately avoids "diagnos", which fails scripts/lint-claims.sh.
 */
export const STAGES = [
  "Uploading clips",
  "Extracting frames",
  "Locating body landmarks",
  "Computing joint angles",
  "Checking measurement quality",
  "Comparing with references",
];

export function AnalysisStages({ activeStage }: { activeStage: number }) {
  return (
    <View style={styles.list}>
      {STAGES.map((label, index) => (
        <Stage key={label} label={label} state={index < activeStage ? "done" : index === activeStage ? "active" : "pending"} />
      ))}
    </View>
  );
}

function Stage({ label, state }: { label: string; state: "pending" | "active" | "done" }) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: state === "active" ? 1 : state === "done" ? 0.55 : 0.3,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [state, opacity]);

  return (
    <Animated.View style={[styles.row, { opacity }]}>
      <View style={[styles.tick, state !== "pending" && styles.tickOn]}>
        <Text style={styles.tickText}>{state === "done" ? "✓" : ""}</Text>
      </View>
      <Text style={styles.label}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: 28, alignSelf: "stretch" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 7 },
  tick: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1.6,
    borderColor: "#6e3fc9", marginRight: 12, alignItems: "center", justifyContent: "center",
  },
  tickOn: { borderColor: "#39ffc4", backgroundColor: "rgba(57,255,196,0.16)" },
  tickText: { color: "#39ffc4", fontSize: 11, fontWeight: "800" },
  label: { color: "#efeaf6", fontSize: 14 },
});
```

- [ ] **Step 2: Build the analysis screen**

Create `apps/mobile/src/app/analysis.tsx`:

```tsx
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { countMetricResults } from "../api/events";
import { getClinicianToken } from "../auth/tokenStore";
import { AnalysisStages, STAGES } from "../components/AnalysisStages";

const POLL_MS = 2000;
const GIVE_UP_MS = 120000;

export default function AnalysisScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    // Stages 0-2 are local progress indication while the server works; stage
    // advances past 2 only when real metric results start arriving.
    const ticker = setInterval(() => {
      setStage((current) => (current < 2 ? current + 1 : current));
    }, 1800);

    async function poll() {
      try {
        const token = await getClinicianToken();
        if (!token) return router.replace("/login");
        const count = await countMetricResults(sessionId, token);
        if (cancelled) return;
        if (count > 0) {
          setStage(STAGES.length);
          clearInterval(ticker);
          return router.replace({ pathname: "/results", params: { sessionId } });
        }
        if (Date.now() - startedAt > GIVE_UP_MS) {
          setError("Analysis is taking longer than expected. The clips were uploaded — check the dashboard.");
          clearInterval(ticker);
          return;
        }
        setTimeout(poll, POLL_MS);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not check analysis progress.");
      }
    }
    poll();

    return () => {
      cancelled = true;
      clearInterval(ticker);
    };
  }, [sessionId]);

  return (
    <View style={styles.screen}>
      <Text style={styles.eyebrow}>ANALYSING</Text>
      <AnalysisStages activeStage={stage} />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0e0a16", padding: 32, justifyContent: "center" },
  eyebrow: { color: "#9d93ae", fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  error: { color: "#ff6b6b", marginTop: 24, lineHeight: 20 },
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/AnalysisStages.tsx apps/mobile/src/app/analysis.tsx
git commit -m "feat(mobile): add six-stage analysis screen"
```

---

## Task 12: Results

**Files:**
- Create: `apps/mobile/src/api/events.ts`
- Create: `apps/mobile/src/app/results.tsx`
- Test: `apps/mobile/src/api/events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/api/events.test.ts`:

```ts
import { countMetricResults, listMetricResults } from "./events";

const event = (payload: unknown) => ({ type: "metric-result", payload });

describe("events api", () => {
  afterEach(() => jest.restoreAllMocks());

  it("keeps only metric-result events", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => [
        { type: "quality-gate-flag", payload: {} },
        event({ metricKey: "static.head_lateral_tilt", estimate: { value: 1, uncertainty: 2 } }),
      ],
    }) as unknown as typeof fetch;

    const results = await listMetricResults("s-1", "tok");
    expect(results).toHaveLength(1);
    expect(results[0].metricKey).toBe("static.head_lateral_tilt");
  });

  it("counts results so the analysis screen knows when to advance", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => [event({ metricKey: "a" }), event({ metricKey: "b" })],
    }) as unknown as typeof fetch;

    await expect(countMetricResults("s-1", "tok")).resolves.toBe(2);
  });

  it("returns zero when nothing has been analysed yet", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => [],
    }) as unknown as typeof fetch;

    await expect(countMetricResults("s-1", "tok")).resolves.toBe(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest src/api/events.test.ts
```
Expected: FAIL — `Cannot find module './events'`.

- [ ] **Step 3: Implement**

Create `apps/mobile/src/api/events.ts`:

```ts
import { request } from "./http";

/**
 * One measurement as the pipeline emitted it. Exactly one of `estimate`,
 * `unsupported` or `notMeasurable` is present - a measurement that could not be
 * taken says so and says why, and is never silently omitted (CLAUDE.md rule 3).
 */
export interface MetricResult {
  metricKey: string;
  stepId?: string;
  side?: string | null;
  unit?: string;
  tier?: string;
  estimate?: { value: number; uncertainty: number } | null;
  unsupported?: { reasons: string[] } | null;
  notMeasurable?: { reason: string } | null;
}

interface EventRecord {
  type: string;
  payload: unknown;
}

/** GET /sessions/:id/events is clinician-only, so this takes the clinician JWT. */
export async function listMetricResults(sessionId: string, token: string): Promise<MetricResult[]> {
  const events = await request<EventRecord[]>(
    `/sessions/${encodeURIComponent(sessionId)}/events`,
    { token }
  );
  return events.filter((e) => e.type === "metric-result").map((e) => e.payload as MetricResult);
}

export async function countMetricResults(sessionId: string, token: string): Promise<number> {
  return (await listMetricResults(sessionId, token)).length;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/mobile && npx jest src/api/events.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Build the results screen**

Create `apps/mobile/src/app/results.tsx`:

```tsx
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { listMetricResults, MetricResult } from "../api/events";
import { getClinicianToken } from "../auth/tokenStore";

function formatResult(result: MetricResult): string {
  if (result.estimate) {
    const { value, uncertainty } = result.estimate;
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(1)} ± ${uncertainty.toFixed(1)}${result.unit === "deg" ? "°" : ` ${result.unit ?? ""}`}`;
  }
  // Never blank, never zero-filled: an unmeasurable row states its reason.
  if (result.unsupported) return `Not measured — ${result.unsupported.reasons.join(", ")}`;
  if (result.notMeasurable) return `Not measurable — ${result.notMeasurable.reason}`;
  return "No result recorded";
}

export default function ResultsScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [results, setResults] = useState<MetricResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await getClinicianToken();
        if (!token) return router.replace("/login");
        setResults(await listMetricResults(sessionId, token));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load results.");
      }
    })();
  }, [sessionId]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Measurements</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={results}
        keyExtractor={(r, i) => `${r.metricKey}-${r.side ?? ""}-${i}`}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.metric}>
              {item.metricKey}
              {item.side ? ` (${item.side})` : ""}
            </Text>
            <Text style={styles.value}>{formatResult(item)}</Text>
          </View>
        )}
        ListEmptyComponent={!error ? <Text style={styles.empty}>No measurements returned.</Text> : null}
      />
      <Text style={styles.caption}>
        Camera-based estimates. Not a substitute for clinical examination.
      </Text>
      <Pressable style={styles.button} onPress={() => router.replace("/home")}>
        <Text style={styles.buttonText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0e0a16", padding: 20, paddingTop: 60 },
  title: { color: "#efeaf6", fontSize: 26, fontWeight: "800", marginBottom: 16 },
  error: { color: "#ff6b6b", marginBottom: 12 },
  row: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  metric: { color: "#9d93ae", fontSize: 12 },
  value: { color: "#efeaf6", fontSize: 17, fontWeight: "600", marginTop: 3 },
  empty: { color: "#9d93ae", marginTop: 20 },
  caption: { color: "#9d93ae", fontSize: 11, marginTop: 14, textAlign: "center" },
  button: { backgroundColor: "#b98cff", borderRadius: 12, padding: 16, alignItems: "center", marginTop: 14 },
  buttonText: { color: "#0e0a16", fontWeight: "700", fontSize: 16 },
});
```

- [ ] **Step 6: Build the home stub and root layout**

Create `apps/mobile/src/app/home.tsx`:

```tsx
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { clearClinicianToken } from "../auth/tokenStore";

export default function HomeScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>beAIve</Text>
      <Text style={styles.subtitle}>Clinic assessment</Text>

      <Pressable style={styles.button} onPress={() => router.push("/patient")}>
        <Text style={styles.buttonText}>New scan</Text>
      </Pressable>

      <Pressable
        onPress={async () => {
          await clearClinicianToken();
          router.replace("/login");
        }}
      >
        <Text style={styles.signOut}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0e0a16", padding: 28, justifyContent: "center" },
  title: { color: "#efeaf6", fontSize: 34, fontWeight: "800" },
  subtitle: { color: "#9d93ae", fontSize: 15, marginBottom: 32 },
  button: { backgroundColor: "#b98cff", borderRadius: 12, padding: 18, alignItems: "center" },
  buttonText: { color: "#0e0a16", fontWeight: "700", fontSize: 16 },
  signOut: { color: "#9d93ae", textAlign: "center", marginTop: 28 },
});
```

Replace `apps/mobile/src/app/index.tsx` (currently an unstyled template stub). The root layout redirects away from it on mount, so its only job is to match the app background and avoid a white flash on launch:

```tsx
import { View } from "react-native";

/** Shown for the moment before the root layout redirects to login or home. */
export default function Index() {
  return <View style={{ flex: 1, backgroundColor: "#0e0a16" }} />;
}
```

Create `apps/mobile/src/app/_layout.tsx`:

```tsx
import { Stack, router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { setUnauthorizedHandler } from "../api/http";
import { clearClinicianToken, getClinicianToken } from "../auth/tokenStore";

export default function RootLayout() {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Any 401 from any screen drops the stored token and returns to login.
    setUnauthorizedHandler(() => {
      void clearClinicianToken();
      router.replace("/login");
    });

    (async () => {
      const token = await getClinicianToken();
      router.replace(token ? "/home" : "/login");
      setChecked(true);
    })();

    return () => setUnauthorizedHandler(null);
  }, []);

  if (!checked) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0e0a16", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#b98cff" />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0e0a16" } }} />;
}
```

- [ ] **Step 7: Run the whole suite and typecheck**

```bash
cd apps/mobile && npx jest && npx tsc --noEmit
```
Expected: all tests pass; no typecheck output.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/api/events.ts apps/mobile/src/api/events.test.ts apps/mobile/app
git commit -m "feat(mobile): add results screen and app shell"
```

---

## Task 13: Device verification

No simulator can validate camera framing or gravity, so this task runs on real hardware against production.

**Files:** none (verification only)

- [ ] **Step 1: Build and install a dev client**

```bash
cd apps/mobile
npx eas build --profile development --platform ios
```

If the build fails with a Program License Agreement error, the Apple Account Holder must accept the updated agreement at developer.apple.com first. This is an account issue, not a code issue.

- [ ] **Step 2: Verify the gravity axis mapping**

This is the single most important check — if it is wrong, every angle is wrong and nothing else will reveal it.

Add a temporary log in `apps/mobile/src/app/capture.tsx` inside `onRecordingFinished`, after `buildSidecar`:

```tsx
console.log("gravity[0]", sidecar.frames[0].gravity);
```

Hold the phone upright and level, record one clip, and read the log.

Expected: approximately `[0, 1, 0]`, matching the schema's own stated check ("a level phone filming upright yields approximately [0, 1, 0]").

If y is negative, the sign convention in `toCameraFrameGravity` is inverted — fix it there, not at the call site. Remove the log once confirmed.

- [ ] **Step 3: Walk the full flow**

Run through each and confirm:

1. Log in as a clinician; force-quit and reopen — still logged in.
2. Search the patient register; a known patient appears.
3. Give consent; capture begins without error.
4. **The subject fills the screen** — no letterboxing, no toy-sized person.
5. Record all four poses.
6. The analysis screen advances and lands on results.
7. Real measurements appear.

- [ ] **Step 4: Confirm the recording matches the preview**

Capture a pose with the subject's head and feet just inside the frame edges. Then open the same session in the clinician web dashboard and check the returned measurements are not flagged out-of-frame.

Expected: no `out_of_frame` quality flags. If there are, the preview is showing a crop of a wider recording and the format selection in `capture.tsx` needs fixing.

Then confirm the **recorded aspect ratio** matches what the sidecar declares. The app reports `TARGET_RESOLUTION` (1080x1920) rather than the resolution the pipeline actually selected, which is safe only because vision-camera prioritises the target's aspect ratio over its pixel count — and ml-service feeds those dimensions into `analyze_observations`. Verify it rather than trusting the documentation: on the server, inspect an uploaded clip.

```bash
ssh -p 18755 ubuntu@103.118.158.129
# then, against the stored clip for this session:
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 <clip-path>
```

Expected: a 9:16 ratio (1080x1920, 720x1280, or similar). A different **ratio** — 4:3, say — means every angle is being computed against a distorted frame, and `TARGET_RESOLUTION` must then be replaced with the pipeline's selected resolution. A different pixel count at the same ratio is fine and needs no change.

- [ ] **Step 5: Cross-check against the dashboard**

Open the same session at `http://localhost:5173/reports` (clinician-web pointed at production). Build a draft report and confirm the values match what the phone displayed.

Expected: identical numbers. A mismatch means the app is reading the wrong events.

- [ ] **Step 6: Test interruption recovery**

Enable airplane mode immediately after the first pose records. Confirm the app shows the upload failure with the server's reason, not a silent continue or a crash. Turn airplane mode off and press Start again.

Expected: the pose re-records and uploads, and the run completes normally. P1 recovers by re-recording, not by resuming a queued upload.

- [ ] **Step 7: Run the claims lint**

```bash
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1
npm run lint:claims
```
Expected: pass. If it fails on the new app, the offending copy must be reworded — not excluded from the lint.

- [ ] **Step 8: Commit any fixes**

```bash
git add apps/mobile
git commit -m "fix(mobile): corrections from device verification"
```

---

## Task 14: Archive the SwiftUI client

Only once Task 13 passes end to end. Until then it is the fallback.

**Files:**
- Delete: `apps/ios-client/`
- Modify: `README.md`

- [ ] **Step 1: Confirm the Expo app works**

Do not start this task unless every check in Task 13 passed on a real device.

- [ ] **Step 2: Remove the old client**

```bash
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1
git rm -r apps/ios-client
```

- [ ] **Step 3: Update the README**

In `README.md`, replace any reference to `apps/ios-client` as the mobile client with `apps/mobile`, noting it is an Expo app requiring an EAS custom dev build.

- [ ] **Step 4: Verify nothing else references it**

```bash
grep -rn "ios-client" --include='*.md' --include='*.ts' --include='*.json' . | grep -v node_modules | grep -v '\.git/'
```
Expected: only historical mentions in `docs/` and ADRs, which stay as they are — they record what was true at the time.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: archive the SwiftUI client in favour of apps/mobile

The Expo client at apps/mobile covers the full clinic assessment flow and is
the only mobile client from here. Git history retains the SwiftUI app."
```

---

## Done when

- `cd apps/mobile && npx jest` — all tests pass.
- `cd apps/mobile && npx tsc --noEmit` — clean.
- `npm run lint:claims` — passes.
- A clinician completes login → patient → consent → four poses → real measurements on a physical device against `https://posture.beaive.com`.
- Gravity frame zero reads approximately `[0, 1, 0]` with the phone upright.
- The subject fills the screen during capture, and the recorded clip matches what was previewed.
