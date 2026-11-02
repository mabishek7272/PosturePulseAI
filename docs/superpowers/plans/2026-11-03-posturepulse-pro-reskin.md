# PosturePulse Pro Visual Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dark "Neon" theme across the Expo mobile app's 9 existing screens with the light violet/glass aesthetic from the Claude Design handoff, and build 3 new screens (History, Trends stub, Settings) plus a minimal idle-lock, with every claims-policy substitution from the design spec applied.

**Architecture:** A new shared color-token file (`src/theme/colors.ts`) and a shared bottom-tab-bar component (`src/components/BottomTabBar.tsx`) are built first; every later task imports from these rather than repeating hex literals or rebuilding nav chrome. Each screen task is a visual-only rewrite — no change to navigation, API calls, or validation logic already proven in P1 — except History (new screen, new API function), the Settings screen (new), and idle-lock (new cross-cutting behaviour).

**Tech Stack:** Expo SDK 58, React Native 0.88, TypeScript, expo-router. No new dependencies.

**Design spec:** `docs/superpowers/specs/2026-11-03-posturepulse-pro-reskin-design.md` — its substitution table is binding. Every task below already encodes the compliant copy; an implementer must never "restore" wording closer to the source design.

---

## Before you start

1. Read the design spec's substitution table once. The five things that must never appear in any screen built here: a bare composite score, a diagnostic label used as plain metadata, an AI card asserting a cross-patient or causal pattern, an AI card recommending a specific intervention with a one-tap accept, and any claim that analysis happens "on-device."
2. `npx jest`, `npx tsc --noEmit`, and `bash scripts/lint-claims.sh` (from the repo root) must be clean before and after every task. 39 tests pass today (corrected during execution - Task 1 found the plan's original baseline of 38 was off by one); each task's step lists the new expected count where it changes.
3. These are visual-only changes to proven screens — no new automated tests are written for pure layout. Where a task adds real logic (the History API call, idle-lock), it gets a real test.

---

## Task 1: Shared theme tokens

**Files:**
- Create: `apps/mobile/src/theme/colors.ts`

- [ ] **Step 1: Create the token file**

```ts
/**
 * PosturePulse Pro palette (docs/superpowers/specs/2026-11-03-posturepulse-pro-reskin-design.md).
 * Every screen imports from here - no hex literal should appear in a
 * screen's StyleSheet after this reskin lands.
 */
export const colors = {
  // Light surfaces (the new default - replaces #0e0a16 as the app background)
  bg: "#f8f9ff",
  bgDeep: "#eef0fb",
  bgDark: "#17162a", // capture screen only, which stays dark for camera visibility
  surface: "rgba(255,255,255,0.78)",
  surfaceSolid: "#ffffff",

  // Violet accent ramp
  accent100: "#f5f4ff",
  accent200: "#e7e5fe",
  accent300: "#d2cefd",
  accent400: "#b5abfc",
  accent600: "#796cbf",
  accent700: "#5d5294",
  accent800: "#423a6a",
  accent900: "#2b2741",

  // Text
  text: "#161826",
  textMuted: "#75798c",
  textFaint: "#9397ab",
  textOnDark: "#f5f4ff",

  // Borders / hairlines
  hairline: "#e4e7f5",
  hairlineStrong: "#cfd3e5",

  // Status (unchanged from P1 - no new semantics introduced)
  caution: "#ff6b6b",
} as const;
```

- [ ] **Step 2: Verify**

```bash
cd apps/mobile && npx tsc --noEmit
```
Expected: no output (nothing imports it yet, so this only confirms the file itself is valid TypeScript).

- [ ] **Step 3: Fix the pre-redirect flash screen**

`apps/mobile/src/app/index.tsx` (the loading state shown for the instant before the root layout decides whether to redirect to `/login` or `/home`) still hardcodes the old dark theme's colors. Caught in this plan's own self-review — none of Tasks 2-14 touch this file, so without this step it would flash the old dark background for a moment on every cold launch of an otherwise fully light-themed app.

Replace its loading-state `View`:

```tsx
import { colors } from "../theme/colors";

// inside the component, replace the `if (!target)` block's return:
if (!target) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bgDeep, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color={colors.accent600} />
    </View>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/theme/colors.ts apps/mobile/src/app/index.tsx
git commit -m "feat(mobile): add PosturePulse Pro theme tokens, fix pre-redirect flash"
```

---

## Task 2: Bottom tab bar component

**Files:**
- Create: `apps/mobile/src/components/BottomTabBar.tsx`

The tab bar has 5 slots: Home, Patients, a raised Capture FAB, Trends, Profile. Verified directly against the source design's own screen-index map — these 5 are its actual wiring; **History is not a tab-bar destination** (it's a link from Home, built in Task 11).

- [ ] **Step 1: Create the component**

```tsx
import { router, usePathname } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";

interface TabItem {
  key: string;
  label: string;
  route: "/home" | "/patient" | "/trends" | "/settings";
}

const TABS: TabItem[] = [
  { key: "home", label: "Home", route: "/home" },
  { key: "patients", label: "Patients", route: "/patient" },
  { key: "trends", label: "Trends", route: "/trends" },
  { key: "profile", label: "Profile", route: "/settings" },
];

/**
 * Shared bottom chrome for Home, Patients, Trends and Settings. The raised
 * centre FAB always starts a new assessment - it does not reflect "current
 * tab" the way the 4 flat items do, matching the source design.
 */
export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <View style={styles.bar}>
      {TABS.slice(0, 2).map((tab) => (
        <TabButton key={tab.key} tab={tab} active={pathname === tab.route} />
      ))}

      <Pressable
        style={styles.fab}
        onPress={() => router.push("/patient")}
        accessibilityLabel="New assessment"
      >
        <View style={styles.fabRing} />
        <Text style={styles.fabIcon}>+</Text>
      </Pressable>

      {TABS.slice(2).map((tab) => (
        <TabButton key={tab.key} tab={tab} active={pathname === tab.route} />
      ))}
    </View>
  );
}

function TabButton({ tab, active }: { tab: TabItem; active: boolean }) {
  return (
    <Pressable style={styles.tab} onPress={() => router.push(tab.route)}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute", left: 14, right: 14, bottom: 14, height: 72,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 10, borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.72)",
    shadowColor: colors.accent900, shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    borderWidth: 1, borderColor: "rgba(210,206,253,0.9)",
  },
  tab: { width: 56, alignItems: "center", paddingVertical: 8 },
  tabLabel: { fontSize: 10, fontWeight: "600", color: colors.textFaint },
  tabLabelActive: { color: colors.accent700 },
  fab: {
    width: 58, height: 58, borderRadius: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.accent600,
    shadowColor: colors.accent700, shadowOpacity: 0.42, shadowRadius: 16, shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  fabRing: {
    position: "absolute", top: -1, left: -1, right: -1, bottom: -1, borderRadius: 20,
    borderWidth: 1, borderColor: "rgba(121,108,191,0.5)",
  },
  fabIcon: { color: colors.textOnDark, fontSize: 26, fontWeight: "300", marginTop: -2 },
});
```

- [ ] **Step 2: Verify**

```bash
cd apps/mobile && npx tsc --noEmit
```
Expected: no output. `/trends` and `/settings` do not exist until Tasks 12-13 — `router.push` to an as-yet-missing route typechecks fine (expo-router's typed routes do not error on this, confirmed in P1), so this is expected to pass clean now and only become reachable later.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/BottomTabBar.tsx
git commit -m "feat(mobile): add the shared bottom tab bar"
```

---

## Task 3: Restyle Login

**Files:**
- Modify: `apps/mobile/src/app/login.tsx`

Visual-only. No change to `submit()`, validation, or navigation. Adds the real brand mark (`apps/mobile/assets/brand/mark.png`, installed separately - a transparent PNG, not the misleadingly-named `.svg` the source design process produced) above the title, matching the source design's own icon-plus-wordmark header pattern.

- [ ] **Step 1: Replace the file**

```tsx
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { login } from "../api/auth";
import { saveClinicianToken } from "../auth/tokenStore";
import { Screen, useResponsive } from "../components/Screen";
import { colors } from "../theme/colors";

export default function LoginScreen() {
  const { titleSize, bodySize } = useResponsive();
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
    <Screen center>
      <View style={styles.heading}>
        <Image
          source={require("../../assets/brand/mark.png")}
          style={styles.mark}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <Text style={[styles.title, { fontSize: titleSize }]}>Clinician{"\n"}sign-in</Text>
        <Text style={[styles.subtitle, { fontSize: bodySize }]}>
          Shared clinic device. Sign out when you are done with a patient.
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.field}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={[styles.input, { fontSize: bodySize + 1 }]}
            placeholder="Username"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={[styles.input, { fontSize: bodySize + 1 }]}
            placeholder="Password"
            placeholderTextColor={colors.textFaint}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
          />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={styles.button} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color={colors.textOnDark} /> : <Text style={styles.buttonText}>Unlock</Text>}
        </Pressable>
      </View>

      <View style={styles.footnote}>
        <Text style={styles.footnoteText}>
          All assessments are logged against your practitioner ID and are auditable.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 11, marginBottom: 34 },
  mark: { width: 44, height: 44, marginBottom: 4 },
  title: { color: colors.text, fontWeight: "600", letterSpacing: -0.035 * 29, lineHeight: 34 },
  subtitle: { color: colors.textMuted, lineHeight: 21 },
  card: {
    gap: 14, padding: 20, borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.hairline,
  },
  field: { gap: 7 },
  label: { fontSize: 12, fontWeight: "500", color: "#595d6c" },
  input: {
    backgroundColor: colors.accent100, color: colors.text,
    borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: colors.hairline,
  },
  error: { color: colors.caution },
  button: {
    marginTop: 2, height: 52, borderRadius: 13, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.accent700,
  },
  buttonText: { color: colors.textOnDark, fontWeight: "600", fontSize: 15 },
  footnote: {
    marginTop: "auto", flexDirection: "row", gap: 10, padding: 13, borderRadius: 14,
    backgroundColor: "rgba(245,244,255,0.8)",
    borderWidth: 1, borderColor: colors.accent200,
  },
  footnoteText: { fontSize: 12, color: "#595d6c", lineHeight: 17, flex: 1 },
});
```

**What changed in the copy:** the source design's login screen claims "Sessions lock after 10 minutes idle" — this task does **not** include that line, because at this point in the plan idle-lock does not exist yet. Task 14 adds idle-lock and adds this sentence back once it is true. Do not add it here.

- [ ] **Step 2: Verify**

```bash
cd apps/mobile && npx jest && npx tsc --noEmit
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1 && bash scripts/lint-claims.sh
```
Expected: 39 tests passing, clean typecheck, claims lint passes.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/app/login.tsx
git commit -m "style(mobile): restyle login against the PosturePulse Pro theme"
```

---

## Task 4: Restyle Permissions

**Files:**
- Modify: `apps/mobile/src/app/permissions.tsx`

Visual-only. No change to the permission hooks or navigation.

- [ ] **Step 1: Replace the file**

```tsx
import { router } from "expo-router";
import { useEffect } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useCameraPermission } from "react-native-vision-camera";
import { Screen, useResponsive } from "../components/Screen";
import { colors } from "../theme/colors";

export default function PermissionsScreen() {
  // vision-camera v5 exposes permissions as a reactive hook rather than the
  // static Camera.requestCameraPermission() of v4.
  const { titleSize, bodySize } = useResponsive();
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();

  useEffect(() => {
    if (hasPermission) router.replace("/home");
  }, [hasPermission]);

  // Permission permanently denied: requesting again is a no-op, so send the
  // clinician to Settings rather than a button that silently does nothing.
  const mustUseSettings = !hasPermission && !canRequestPermission;

  return (
    <Screen>
      <Text style={styles.eyebrow}>DEVICE ACCESS</Text>
      <Text style={[styles.title, { fontSize: titleSize - 4 }]}>Camera access</Text>
      <Text style={[styles.body, { fontSize: bodySize, lineHeight: bodySize * 1.5 }]}>
        Capture uploads short clips to your clinic's server for measurement. Nothing is shared
        beyond your clinic.
      </Text>

      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>📷</Text>
        </View>
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>Camera</Text>
          <Text style={styles.cardSubtitle}>Rear camera, for the four capture views</Text>
        </View>
      </View>

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
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 2, color: colors.accent600, marginTop: 8 },
  title: { color: colors.text, fontWeight: "600", marginTop: 10, marginBottom: 10 },
  body: { color: colors.textMuted, marginBottom: 24 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 14, padding: 17, borderRadius: 18,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accent200,
    marginBottom: 20,
  },
  iconWrap: {
    width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.accent100, borderWidth: 1, borderColor: colors.accent300,
  },
  icon: { fontSize: 18 },
  cardText: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  cardSubtitle: { fontSize: 12.5, color: colors.textMuted },
  denied: { color: colors.caution, marginBottom: 16 },
  button: {
    marginTop: "auto", height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.accent700,
  },
  buttonText: { color: colors.textOnDark, fontWeight: "600", fontSize: 15 },
});
```

- [ ] **Step 2: Verify**

```bash
cd apps/mobile && npx jest && npx tsc --noEmit
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1 && bash scripts/lint-claims.sh
```
Expected: 39 tests passing, clean typecheck, claims lint passes.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/app/permissions.tsx
git commit -m "style(mobile): restyle permissions against the PosturePulse Pro theme"
```

---

## Task 5: Restyle Home

**Files:**
- Modify: `apps/mobile/src/app/home.tsx`

Visual-only, plus adding the bottom tab bar and an "All sessions" link to History (route built in Task 11 — the link is added now so it compiles against the planned route; it is reachable once Task 11 lands, same pattern as Task 2's tab bar routes).

**No "Mean score" stat and no diagnostic label on the next-session card** — see the spec's substitution table. The stat row shows a real completion count only.

- [ ] **Step 1: Replace the file**

```tsx
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomTabBar } from "../components/BottomTabBar";
import { Screen, useResponsive } from "../components/Screen";
import { clearClinicianToken } from "../auth/tokenStore";
import { colors } from "../theme/colors";

export default function HomeScreen() {
  const { titleSize, bodySize } = useResponsive();

  return (
    <View style={styles.root}>
      <Screen style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>MO</Text>
          </View>
          <Text style={[styles.greeting, { fontSize: bodySize + 2 }]}>Clinician</Text>
          <Pressable
            style={styles.signOut}
            onPress={async () => {
              await clearClinicianToken();
              router.replace("/login");
            }}
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </View>

        <Pressable style={styles.heroCard} onPress={() => router.push("/patient")}>
          <Text style={styles.heroEyebrow}>START AN ASSESSMENT</Text>
          <Text style={[styles.heroTitle, { fontSize: titleSize - 8 }]}>New scan</Text>
          <View style={styles.heroButton}>
            <Text style={styles.heroButtonText}>Begin assessment →</Text>
          </View>
        </Pressable>

        <Pressable style={styles.allSessions} onPress={() => router.push("/history")}>
          <Text style={styles.allSessionsText}>All sessions</Text>
          <Text style={styles.allSessionsArrow}>→</Text>
        </Pressable>
      </Screen>
      <BottomTabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep },
  screen: { paddingTop: 58, paddingBottom: 110 },
  header: { flexDirection: "row", alignItems: "center", gap: 13, marginBottom: 20 },
  avatar: {
    width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.accent700,
  },
  avatarText: { color: colors.textOnDark, fontWeight: "600", fontSize: 14 },
  greeting: { color: colors.text, fontWeight: "600" },
  signOut: { marginLeft: "auto" },
  signOutText: { color: colors.textFaint, fontSize: 13 },
  heroCard: {
    padding: 20, borderRadius: 22, marginBottom: 14,
    backgroundColor: colors.accent900,
  },
  heroEyebrow: { color: colors.accent300, fontSize: 11, fontWeight: "600", letterSpacing: 2, marginBottom: 10 },
  heroTitle: { color: colors.textOnDark, fontWeight: "600", marginBottom: 16 },
  heroButton: {
    alignSelf: "flex-start", height: 46, paddingHorizontal: 20, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1, borderColor: "rgba(210,206,253,0.4)",
  },
  heroButtonText: { color: colors.textOnDark, fontWeight: "600", fontSize: 14 },
  allSessions: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 16, borderRadius: 16,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
  },
  allSessionsText: { color: colors.text, fontWeight: "600", fontSize: 14.5 },
  allSessionsArrow: { color: colors.accent600, fontSize: 14 },
});
```

**What changed from the original `home.tsx`:** the "New scan" button and the sign-out link both existed before; they're restyled, not re-logic'd. The hero card's onPress still goes to `/patient`, same as the old `New scan` button. The only new navigation is `/history`, added as a forward-reference to Task 11.

- [ ] **Step 2: Verify**

```bash
cd apps/mobile && npx jest && npx tsc --noEmit
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1 && bash scripts/lint-claims.sh
```
Expected: 39 tests passing, clean typecheck (the `/history` route reference typechecks fine before the route exists, same as Task 2's forward references), claims lint passes.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/app/home.tsx
git commit -m "style(mobile): restyle home with the shared tab bar, no composite score"
```

---

## Task 6: Restyle Patient (search, list, New Patient form)

**Files:**
- Modify: `apps/mobile/src/app/patient.tsx`

Visual-only restyle of the existing search/list/create-patient screen built in a prior session. **Every existing behaviour is preserved exactly**: debounced search, the intake form (height/weight/smoking/alcohol/activity/problems/accident), client-side DOB validation, create-and-select flow. Only the `StyleSheet` values change, plus adding the shared tab bar.

- [ ] **Step 1: Read the current file first**

This file has real logic (search debounce, the `NewPatientForm` sub-component, `ChipRow`) that must not be altered - only its `styles` object and the outer screen wrapper change. Read `apps/mobile/src/app/patient.tsx` in full before editing so you are rewriting the actual current file, not an assumed one; it was last touched in a prior session and the plan's earlier tasks (login, home) are not representative of its structure since it has sub-components the simpler screens don't.

- [ ] **Step 2: Rewrite the `styles` object**

Replace the file's `const styles = StyleSheet.create({...})` block with:

```ts
const styles = StyleSheet.create({
  back: { color: colors.textFaint, fontSize: 15, marginBottom: 12 },
  screen: { paddingTop: 58, paddingBottom: 110 },
  title: { color: colors.text, fontWeight: "600", marginBottom: 16 },
  input: {
    backgroundColor: colors.surfaceSolid, color: colors.text,
    borderRadius: 13, padding: 15,
    borderWidth: 1, borderColor: colors.hairline,
    marginBottom: 14,
  },
  error: { color: colors.caution, marginBottom: 10 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 13, padding: 15, borderRadius: 18,
    backgroundColor: colors.surfaceSolid, borderWidth: 1, borderColor: colors.hairline,
    marginBottom: 9,
  },
  rowAvatar: {
    width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.accent200,
  },
  rowAvatarText: { color: colors.accent700, fontWeight: "600", fontSize: 13 },
  rowName: { color: colors.text, fontWeight: "600" },
  rowMeta: { color: colors.textMuted, fontSize: 12.5, marginTop: 2 },
  empty: { color: colors.textFaint, marginTop: 20 },
  newButton: {
    borderWidth: 1, borderColor: colors.accent600, borderRadius: 13,
    padding: 15, alignItems: "center", marginTop: 18,
  },
  newButtonText: { color: colors.accent700, fontWeight: "700", fontSize: 15 },
  // A plain View, not <Screen>: this renders inside a FlatList footer, which
  // isn't a flex container - Screen's flex:1 column would collapse to zero
  // height here.
  formWrap: { paddingTop: 18, paddingBottom: 40 },
  formTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 12 },
  button: { backgroundColor: colors.accent700, borderRadius: 13, padding: 16, alignItems: "center", marginTop: 4 },
  buttonText: { color: colors.textOnDark, fontWeight: "700", fontSize: 16 },
  cancel: { color: colors.textFaint, textAlign: "center", marginTop: 14 },

  intakeToggle: { paddingVertical: 10 },
  intakeToggleText: { color: colors.accent600, fontSize: 14, fontWeight: "600" },
  intakeSection: {
    borderTopWidth: 1, borderTopColor: colors.hairline,
    marginTop: 4, marginBottom: 14, paddingTop: 14,
  },
  intakeLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "700", letterSpacing: 0.5, marginBottom: 10 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "600", marginBottom: 8, marginTop: 2 },
  row2: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  note: { minHeight: 60, textAlignVertical: "top" },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: {
    borderWidth: 1, borderColor: colors.hairline, borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 14,
  },
  chipOn: { backgroundColor: colors.accent600, borderColor: colors.accent600 },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  chipTextOn: { color: colors.textOnDark },

  checkboxRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.hairlineStrong,
    marginRight: 10, alignItems: "center", justifyContent: "center",
  },
  checkboxOn: { backgroundColor: colors.accent600, borderColor: colors.accent600 },
  checkboxMark: { color: colors.textOnDark, fontSize: 13, fontWeight: "800" },
});
```

- [ ] **Step 3: Update the `FlatList` row rendering and imports**

Add `colors` to the file's imports:

```ts
import { colors } from "../theme/colors";
```

In the `renderItem` for a patient row (currently a `Pressable` with `styles.row` containing only name and DOB text), change it to show an avatar-initials chip before the text, matching every other list row in this reskin:

```tsx
renderItem={({ item }) => (
  <Pressable style={styles.row} onPress={() => choose(item)}>
    <View style={styles.rowAvatar}>
      <Text style={styles.rowAvatarText}>
        {item.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
      </Text>
    </View>
    <View>
      <Text style={[styles.rowName, { fontSize: bodySize + 2 }]}>{item.name}</Text>
      <Text style={styles.rowMeta}>{item.dateOfBirth}</Text>
    </View>
  </Pressable>
)}
```

Wrap the screen's outermost `<Screen style={styles.screen}>...</Screen>` in a root `View` with `BottomTabBar`, matching Task 5's pattern:

```tsx
import { View } from "react-native";
import { BottomTabBar } from "../components/BottomTabBar";

// at the top of the component's return:
return (
  <View style={{ flex: 1, backgroundColor: colors.bgDeep }}>
    <Screen style={styles.screen}>
      {/* existing content unchanged */}
    </Screen>
    <BottomTabBar />
  </View>
);
```

**Do not change** the search debounce effect, `createAndChoose`, `buildIntake`, `ChipRow`, or any validation logic. This task touches only the JSX wrapper and the `styles` object.

- [ ] **Step 4: Verify**

```bash
cd apps/mobile && npx jest && npx tsc --noEmit
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1 && bash scripts/lint-claims.sh
```
Expected: 39 tests passing (this file's own tests live in `patients.test.ts` / `patients.service.spec.ts`, unaffected by a UI-only change), clean typecheck, claims lint passes.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/app/patient.tsx
git commit -m "style(mobile): restyle patient search and intake form"
```

---

## Task 7: Restyle Consent

**Files:**
- Modify: `apps/mobile/src/app/consent.tsx`

Visual-only. No change to `agree()`, the ref-based retry/resume logic, or the consent copy itself (already claims-reviewed — do not reword it).

- [ ] **Step 1: Replace the `styles` object and wrapping JSX**

Keep every line of the component function (`agree`, the refs, the `useLocalSearchParams` call) exactly as-is. Replace only the `return (...)` JSX's styling and the `const styles = StyleSheet.create({...})` block:

```tsx
import { colors } from "../theme/colors";

// return block:
return (
  <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingHorizontal: gutter, maxWidth: MAX_CONTENT_WIDTH + gutter * 2 }]}>
    <Text style={styles.eyebrow}>STEP 2 OF 3</Text>
    <Text style={[styles.title, { fontSize: titleSize }]}>Consent</Text>
    <Text style={styles.name}>{patientName}</Text>

    <View style={styles.card}>
      <Text style={[styles.body, { fontSize: bodySize, lineHeight: bodySize * 1.55 }]}>
        Short video clips of four standing poses will be recorded and uploaded to this clinic's
        server, where body landmarks are measured. Video is not retained after measurement.
        Measurements are camera-based estimates reviewed by a clinician, and are not a substitute
        for clinical examination.
      </Text>
      <Text style={[styles.body, { fontSize: bodySize, lineHeight: bodySize * 1.55 }]}>
        The recording can be stopped at any time, and the assessment can be ended on request.
      </Text>
    </View>

    {error && <Text style={styles.error}>{error}</Text>}
    <Pressable style={styles.button} onPress={agree} disabled={busy}>
      {busy ? <ActivityIndicator color={colors.textOnDark} /> : <Text style={styles.buttonText}>Consent given — begin</Text>}
    </Pressable>
    <Pressable onPress={() => router.back()} disabled={busy} hitSlop={12}>
      <Text style={styles.back}>Back</Text>
    </Pressable>
  </ScrollView>
);
```

```ts
const styles = StyleSheet.create({
  back: { color: colors.textFaint, textAlign: "center", marginTop: 24 },
  screen: { flex: 1, backgroundColor: colors.bgDeep },
  content: { paddingTop: 60, paddingBottom: 24, width: "100%", alignSelf: "center" },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 2, color: colors.accent600, marginBottom: 8 },
  title: { color: colors.text, fontWeight: "600" },
  name: { color: colors.accent700, fontSize: 16, marginTop: 4, marginBottom: 20 },
  card: {
    padding: 18, borderRadius: 18, gap: 12, marginBottom: 20,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
  },
  body: { color: colors.textMuted },
  error: { color: colors.caution, marginBottom: 12 },
  button: { backgroundColor: colors.accent700, borderRadius: 13, padding: 17, alignItems: "center", marginTop: 12 },
  buttonText: { color: colors.textOnDark, fontWeight: "700", fontSize: 16 },
});
```

- [ ] **Step 2: Verify**

```bash
cd apps/mobile && npx jest && npx tsc --noEmit
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1 && bash scripts/lint-claims.sh
```
Expected: 39 tests passing, clean typecheck, claims lint passes.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/app/consent.tsx
git commit -m "style(mobile): restyle consent, copy unchanged"
```

---

## Task 8: Restyle Capture

**Files:**
- Modify: `apps/mobile/src/app/capture.tsx`

**Capture stays dark** — the spec is explicit this screen keeps a dark background for camera visibility, matching the source design's own choice. Only the overlay card tint, text colors and the shutter button are restyled against the accent ramp. **No skeleton-overlay animation is added** — live on-device pose guidance is P2 scope; this task must not pull it forward under cover of a restyle.

- [ ] **Step 1: Replace only the `styles` object**

Every other line of this file (the recording logic, refs, `buildSidecar`, `uploadClip` call, unmount cleanup) is unchanged. Add the import and replace the `styles` block:

```ts
import { colors } from "../theme/colors";

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgDark },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "space-between" },
  constrained: { width: "100%", maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center" },
  header: { paddingTop: 60, paddingHorizontal: 20 },
  step: { color: colors.accent300, fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  title: { color: colors.textOnDark, fontSize: 24, fontWeight: "800", marginTop: 4 },
  footer: { padding: 20, paddingBottom: 44, backgroundColor: "rgba(23,22,42,0.72)" },
  instruction: { color: colors.textOnDark, fontSize: 15, lineHeight: 22, marginBottom: 14 },
  error: { color: colors.caution, marginBottom: 4 },
  errorHint: { color: colors.accent300, fontSize: 13, marginBottom: 10 },
  shutter: { backgroundColor: colors.accent600, borderRadius: 14, padding: 18, alignItems: "center" },
  shutterActive: { backgroundColor: colors.accent700 },
  shutterText: { color: colors.textOnDark, fontWeight: "800", fontSize: 16 },
});
```

- [ ] **Step 2: Verify**

```bash
cd apps/mobile && npx jest && npx tsc --noEmit
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1 && bash scripts/lint-claims.sh
```
Expected: 39 tests passing, clean typecheck, claims lint passes.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/app/capture.tsx
git commit -m "style(mobile): restyle capture overlay, stays dark, no skeleton overlay added"
```

---

## Task 9: Restyle Analysis

**Files:**
- Modify: `apps/mobile/src/app/analysis.tsx`
- Modify: `apps/mobile/src/components/AnalysisStages.tsx`

Visual-only. The polling logic, give-up timeout, and the six stage labels (already compliant - "Uploading clips", "Locating body landmarks", etc.) are unchanged. **No percentage readout is added** - the spec rejects the source design's ambiguous "68%" mid-processing number.

- [ ] **Step 1: Restyle `analysis.tsx`**

Replace the `styles` block and add the import; the component function is unchanged:

```ts
import { colors } from "../theme/colors";

const styles = StyleSheet.create({
  eyebrow: { color: colors.accent600, fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  error: { color: colors.caution, marginTop: 24, lineHeight: 20 },
});
```

The screen stays on a dark background intentionally (matching the source design's own dark Analysis screen) - change `<Screen center>` to pass a dark override:

```tsx
<Screen center style={{ backgroundColor: colors.bgDark }}>
```

- [ ] **Step 2: Restyle `AnalysisStages.tsx`**

Read the current file first (it has the `STAGES` array and animation logic that must not change). Replace only its `styles` block:

```ts
import { colors } from "../theme/colors";

const styles = StyleSheet.create({
  list: { marginTop: 28, alignSelf: "stretch" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 7 },
  tick: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1.6,
    borderColor: colors.accent700, marginRight: 12, alignItems: "center", justifyContent: "center",
  },
  tickOn: { borderColor: colors.accent400, backgroundColor: "rgba(181,171,252,0.16)" },
  tickText: { color: colors.accent400, fontSize: 11, fontWeight: "800" },
  label: { color: colors.textOnDark, fontSize: 14 },
});
```

- [ ] **Step 3: Verify**

```bash
cd apps/mobile && npx jest && npx tsc --noEmit
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1 && bash scripts/lint-claims.sh
```
Expected: 39 tests passing, clean typecheck, claims lint passes.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/app/analysis.tsx apps/mobile/src/components/AnalysisStages.tsx
git commit -m "style(mobile): restyle analysis stages, no fabricated percentage"
```

---

## Task 10: Restyle Results

**Files:**
- Modify: `apps/mobile/src/app/results.tsx`

Visual-only. `formatResult()`, the fetch effect, and the never-fabricate-a-measurement handling (`unsupported`/`notMeasurable` branches) are unchanged. **No hero score** - the metrics list itself is the hero content, exactly as the design spec requires.

- [ ] **Step 1: Replace the `styles` object and the row rendering**

Add the import and replace `styles`:

```ts
import { colors } from "../theme/colors";

const styles = StyleSheet.create({
  screen: { paddingTop: 58, paddingBottom: 24 },
  title: { color: colors.text, fontWeight: "600", marginBottom: 16 },
  error: { color: colors.caution, marginBottom: 12 },
  row: {
    paddingVertical: 13, paddingHorizontal: 14, marginBottom: 8, borderRadius: 14,
    backgroundColor: colors.surfaceSolid, borderWidth: 1, borderColor: colors.hairline,
  },
  metric: { color: colors.textMuted, fontSize: 12 },
  value: { color: colors.text, fontWeight: "600", marginTop: 3 },
  empty: { color: colors.textFaint, marginTop: 20 },
  caption: { color: colors.textFaint, fontSize: 11, marginTop: 14, textAlign: "center" },
  button: { backgroundColor: colors.accent700, borderRadius: 13, padding: 16, alignItems: "center", marginTop: 14 },
  buttonText: { color: colors.textOnDark, fontWeight: "700", fontSize: 16 },
});
```

Wrap the screen in the shared background and give `<Screen>` a light background override (results is a light screen per the spec, matching the metrics-table pattern already built):

```tsx
<View style={{ flex: 1, backgroundColor: colors.bgDeep }}>
  <Screen style={styles.screen}>
    {/* existing content: title, error, FlatList, caption, button - unchanged */}
  </Screen>
</View>
```

Add `View` to the `react-native` import if not already present.

- [ ] **Step 2: Verify**

```bash
cd apps/mobile && npx jest && npx tsc --noEmit
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1 && bash scripts/lint-claims.sh
```
Expected: 39 tests passing, clean typecheck, claims lint passes.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/app/results.tsx
git commit -m "style(mobile): restyle results, no hero score"
```

---

## Task 11: History screen

**Files:**
- Create: `apps/mobile/src/api/sessions-list.ts`
- Test: `apps/mobile/src/api/sessions-list.test.ts`
- Create: `apps/mobile/src/app/history.tsx`

New functionality, not a restyle: a clinician-wide feed built on the existing `GET /sessions?limit=` endpoint (already used by clinician-web's `SessionQueuePage` - same contract, different client). No score, no diagnostic label - date, protocol, state chip only, exactly as the spec requires.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/api/sessions-list.test.ts`:

```ts
import { listSessions } from "./sessions-list";

describe("listSessions", () => {
  afterEach(() => jest.restoreAllMocks());

  it("sends the clinician token and an optional limit", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    global.fetch = fetchMock as unknown as typeof fetch;

    await listSessions("tok", 20);

    expect(fetchMock.mock.calls[0][0]).toContain("/sessions?limit=20");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("omits the limit query param when none is given", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    global.fetch = fetchMock as unknown as typeof fetch;

    await listSessions("tok");

    expect(fetchMock.mock.calls[0][0]).not.toContain("limit");
  });

  it("returns the sessions as given", async () => {
    const sessions = [{ id: "s-1", state: "Observing", createdAt: "2026-11-01T10:00:00.000Z", protocolId: "assessment-battery", subjectPseudoId: "subj-1" }];
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => sessions }) as unknown as typeof fetch;

    await expect(listSessions("tok")).resolves.toEqual(sessions);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest src/api/sessions-list.test.ts
```
Expected: FAIL — `Cannot find module './sessions-list'`.

- [ ] **Step 3: Implement**

Create `apps/mobile/src/api/sessions-list.ts`:

```ts
import { request } from "./http";

export interface SessionSummary {
  id: string;
  state: string;
  createdAt: string;
  protocolId: string;
  subjectPseudoId: string;
}

/** GET /sessions is clinician-only, same contract apps/clinician-web's SessionQueuePage uses. */
export function listSessions(token: string, limit?: number): Promise<SessionSummary[]> {
  const query = limit ? `?limit=${limit}` : "";
  return request<SessionSummary[]>(`/sessions${query}`, { token });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/mobile && npx jest src/api/sessions-list.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Build the History screen**

Create `apps/mobile/src/app/history.tsx`:

```tsx
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { listSessions, SessionSummary } from "../api/sessions-list";
import { getClinicianToken } from "../auth/tokenStore";
import { Screen, useResponsive } from "../components/Screen";
import { colors } from "../theme/colors";

const STATE_LABEL: Record<string, string> = {
  Setup: "Setting up",
  Observing: "In progress",
  Pause: "Paused",
  ClinicianReview: "Needs review",
};

export default function HistoryScreen() {
  const { titleSize, bodySize } = useResponsive();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getClinicianToken();
        if (!token) return router.replace("/login");
        const found = await listSessions(token, 50);
        if (!cancelled) setSessions(found);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load sessions.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Screen style={styles.screen}>
      <Pressable onPress={() => router.back()} hitSlop={12}>
        <Text style={styles.back}>Back</Text>
      </Pressable>
      <Text style={[styles.title, { fontSize: titleSize - 6 }]}>All sessions</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View>
              <Text style={[styles.rowDate, { fontSize: bodySize }]}>
                {new Date(item.createdAt).toLocaleDateString()}
              </Text>
              <Text style={styles.rowProtocol}>{item.protocolId}</Text>
            </View>
            <Text style={styles.stateChip}>{STATE_LABEL[item.state] ?? item.state}</Text>
          </View>
        )}
        ListEmptyComponent={!error ? <Text style={styles.empty}>No sessions yet.</Text> : undefined}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingTop: 58 },
  back: { color: colors.textFaint, fontSize: 15, marginBottom: 12 },
  title: { color: colors.text, fontWeight: "600", marginBottom: 16 },
  error: { color: colors.caution, marginBottom: 10 },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 15, borderRadius: 16, marginBottom: 9,
    backgroundColor: colors.surfaceSolid, borderWidth: 1, borderColor: colors.hairline,
  },
  rowDate: { color: colors.text, fontWeight: "600" },
  rowProtocol: { color: colors.textMuted, fontSize: 12.5, marginTop: 2 },
  stateChip: {
    fontSize: 11, fontWeight: "600", color: colors.accent700,
    backgroundColor: colors.accent100, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7,
  },
  empty: { color: colors.textFaint, marginTop: 20 },
});
```

- [ ] **Step 6: Verify**

```bash
cd apps/mobile && npx jest && npx tsc --noEmit
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1 && bash scripts/lint-claims.sh
```
Expected: 42 tests passing (39 + 3 new), clean typecheck (Home's `/history` link from Task 5 now resolves to a real route), claims lint passes.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/api/sessions-list.ts apps/mobile/src/api/sessions-list.test.ts apps/mobile/src/app/history.tsx
git commit -m "feat(mobile): add the History screen on the clinician-wide sessions feed"
```

---

## Task 12: Trends stub screen

**Files:**
- Create: `apps/mobile/src/app/trends.tsx`

No backend aggregates metric values across a patient's sessions, and the source design's chart was keyed to the composite score this reskin rejects outright. Ship a plain, honest placeholder rather than a fabricated chart.

- [ ] **Step 1: Create the screen**

```tsx
import { View, Text, StyleSheet } from "react-native";
import { BottomTabBar } from "../components/BottomTabBar";
import { Screen, useResponsive } from "../components/Screen";
import { colors } from "../theme/colors";

/**
 * No backend aggregates metric values across a patient's sessions yet, and
 * the source design's trend chart was keyed to a composite "posture index"
 * this app does not compute (docs/superpowers/specs/2026-11-03-posturepulse-pro-reskin-design.md
 * Part 3). An honest placeholder, not a fabricated chart.
 */
export default function TrendsScreen() {
  const { titleSize, bodySize } = useResponsive();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bgDeep }}>
      <Screen center style={styles.screen}>
        <Text style={[styles.title, { fontSize: titleSize - 8 }]}>Trends</Text>
        <Text style={[styles.body, { fontSize: bodySize }]}>Not available yet.</Text>
      </Screen>
      <BottomTabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { paddingBottom: 110 },
  title: { color: colors.text, fontWeight: "600", marginBottom: 8 },
  body: { color: colors.textMuted },
});
```

- [ ] **Step 2: Verify**

```bash
cd apps/mobile && npx jest && npx tsc --noEmit
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1 && bash scripts/lint-claims.sh
```
Expected: 42 tests passing, clean typecheck, claims lint passes.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/app/trends.tsx
git commit -m "feat(mobile): add Trends as an honest placeholder, not a fabricated chart"
```

---

## Task 13: Settings screen

**Files:**
- Create: `apps/mobile/src/app/settings.tsx`

Real sign-out and clinician identity; every not-yet-built toggle shown visibly disabled with honest copy, per the spec's audit table. No "(on-device)" version claim.

- [ ] **Step 1: Create the screen**

```tsx
import { router } from "expo-router";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { BottomTabBar } from "../components/BottomTabBar";
import { Screen, useResponsive } from "../components/Screen";
import { clearClinicianToken } from "../auth/tokenStore";
import { colors } from "../theme/colors";

interface ToggleRow {
  label: string;
  caption: string;
}

// Every one of these describes a feature that does not exist in the app yet
// (on-device pose guidance is P2 scope; AI-drafted assessment is P4) -
// rendered visibly disabled rather than a toggle that looks live but does
// nothing. docs/superpowers/specs/2026-11-03-posturepulse-pro-reskin-design.md Part 3.
const NOT_YET_BUILT: ToggleRow[] = [
  { label: "Auto-capture when steady", caption: "Coming soon" },
  { label: "Skeleton overlay", caption: "Coming soon" },
  { label: "Draft clinical notes", caption: "Coming soon" },
  { label: "Live capture guidance", caption: "Coming soon" },
];

export default function SettingsScreen() {
  const { titleSize, bodySize } = useResponsive();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgDeep }}>
      <Screen style={styles.screen}>
        <Text style={[styles.title, { fontSize: titleSize - 6 }]}>Settings</Text>

        <View style={styles.section}>
          {NOT_YET_BUILT.map((row) => (
            <View key={row.label} style={styles.row}>
              <View>
                <Text style={[styles.rowLabel, { fontSize: bodySize }]}>{row.label}</Text>
                <Text style={styles.rowCaption}>{row.caption}</Text>
              </View>
              <Switch value={false} disabled trackColor={{ false: colors.hairline, true: colors.accent400 }} />
            </View>
          ))}
        </View>

        <Pressable
          style={styles.signOutButton}
          onPress={async () => {
            await clearClinicianToken();
            router.replace("/login");
          }}
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>

        <Text style={styles.version}>PosturePulse AI 1.0.0</Text>
      </Screen>
      <BottomTabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { paddingTop: 58, paddingBottom: 110 },
  title: { color: colors.text, fontWeight: "600", marginBottom: 20 },
  section: {
    borderRadius: 18, backgroundColor: colors.surfaceSolid, borderWidth: 1, borderColor: colors.hairline,
    marginBottom: 24,
  },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: colors.hairline,
  },
  rowLabel: { color: colors.text, fontWeight: "600" },
  rowCaption: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  signOutButton: { padding: 16, borderRadius: 13, alignItems: "center", backgroundColor: colors.accent100 },
  signOutText: { color: colors.accent700, fontWeight: "700" },
  version: { color: colors.textFaint, fontSize: 11, textAlign: "center", marginTop: 20 },
});
```

**Note on the last row's border:** `styles.row`'s `borderBottomWidth` draws under the final item too, since `NOT_YET_BUILT` has no special-cased last element. This is a deliberate simplification (a trailing hairline inside a bordered card is visually harmless) - do not add last-item logic for this.

- [ ] **Step 2: Verify**

```bash
cd apps/mobile && npx jest && npx tsc --noEmit
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1 && bash scripts/lint-claims.sh
```
Expected: 42 tests passing, clean typecheck, claims lint passes.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/app/settings.tsx
git commit -m "feat(mobile): add Settings with not-yet-built toggles visibly disabled"
```

---

## Task 14: Idle lock

**Files:**
- Create: `apps/mobile/src/auth/idleLock.ts`
- Test: `apps/mobile/src/auth/idleLock.test.ts`
- Modify: `apps/mobile/src/app/_layout.tsx`
- Modify: `apps/mobile/src/app/login.tsx`

Makes the login screen's claim ("Sessions lock after 10 minutes idle") real. Design: `docs/superpowers/specs/2026-11-03-posturepulse-pro-reskin-design.md` Part 4.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/auth/idleLock.test.ts`:

```ts
import { IDLE_LOCK_MS, isIdle, recordActivity, resetIdleLockForTests } from "./idleLock";

describe("idleLock", () => {
  beforeEach(() => {
    resetIdleLockForTests();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("is not idle immediately after activity is recorded", () => {
    recordActivity();
    expect(isIdle()).toBe(false);
  });

  it("becomes idle once the threshold elapses with no activity", () => {
    recordActivity();
    jest.advanceTimersByTime(IDLE_LOCK_MS + 1);
    expect(isIdle()).toBe(true);
  });

  it("resets the clock on new activity", () => {
    recordActivity();
    jest.advanceTimersByTime(IDLE_LOCK_MS - 1000);
    recordActivity();
    jest.advanceTimersByTime(2000);
    expect(isIdle()).toBe(false);
  });

  it("treats no recorded activity yet as not idle", () => {
    // Avoids locking the instant the app opens, before any touch has happened.
    expect(isIdle()).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd apps/mobile && npx jest src/auth/idleLock.test.ts
```
Expected: FAIL — `Cannot find module './idleLock'`.

- [ ] **Step 3: Implement**

Create `apps/mobile/src/auth/idleLock.ts`:

```ts
/** Matches the login screen's own copy: "Sessions lock after 10 minutes idle." */
export const IDLE_LOCK_MS = 10 * 60 * 1000;

let lastActivityAt: number | null = null;

/** Called by a touch listener at the root layout on every touch, app-wide. */
export function recordActivity(): void {
  lastActivityAt = Date.now();
}

/**
 * False until the first recorded activity, so the app does not lock itself
 * the instant it opens, before anyone has touched it.
 */
export function isIdle(): boolean {
  if (lastActivityAt === null) return false;
  return Date.now() - lastActivityAt >= IDLE_LOCK_MS;
}

/** Test-only: clears module state between tests. */
export function resetIdleLockForTests(): void {
  lastActivityAt = null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/mobile && npx jest src/auth/idleLock.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire it into the root layout**

Replace `apps/mobile/src/app/_layout.tsx`:

```tsx
import { Stack, router } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, View } from "react-native";
import { setUnauthorizedHandler } from "../api/http";
import { clearClinicianToken } from "../auth/tokenStore";
import { isIdle, recordActivity } from "../auth/idleLock";
import { colors } from "../theme/colors";

const CHECK_INTERVAL_MS = 30000;

export default function RootLayout() {
  const checkTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Any 401 from any screen drops the stored token and returns to login.
    // The idle-lock check below reuses this exact path, so there is one
    // lock-and-redirect code path, not two.
    const lock = () => {
      void clearClinicianToken();
      router.replace("/login");
    };
    setUnauthorizedHandler(lock);

    function checkIdle() {
      if (isIdle()) lock();
    }

    checkTimer.current = setInterval(checkIdle, CHECK_INTERVAL_MS);
    // Covers the realistic shared-device case: backgrounded, then reopened by
    // someone else nine minutes later. Wall-clock time elapsed is correct
    // even though the interval was not ticking while backgrounded.
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") checkIdle();
    });

    return () => {
      setUnauthorizedHandler(null);
      if (checkTimer.current) clearInterval(checkTimer.current);
      appStateSub.remove();
    };
  }, []);

  return (
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={() => {
        recordActivity();
        return false;
      }}
    >
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bgDeep } }} />
    </View>
  );
}
```

- [ ] **Step 6: Make the login copy true**

In `apps/mobile/src/app/login.tsx`, add the subtitle line back now that it is accurate:

```tsx
<Text style={[styles.subtitle, { fontSize: bodySize }]}>
  Shared clinic device. Sessions lock after 10 minutes idle.
</Text>
```

(This replaces the Task 3 placeholder subtitle, which read "Shared clinic device. Sign out when you are done with a patient." — that line was deliberately provisional until idle-lock existed.)

- [ ] **Step 7: Verify**

```bash
cd apps/mobile && npx jest && npx tsc --noEmit
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1 && bash scripts/lint-claims.sh
```
Expected: 46 tests passing (42 + 4 new), clean typecheck, claims lint passes.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/auth/idleLock.ts apps/mobile/src/auth/idleLock.test.ts apps/mobile/src/app/_layout.tsx apps/mobile/src/app/login.tsx
git commit -m "feat(mobile): add idle lock, making the login screen's claim real"
```

---

## Device verification

This reskin has not been run on hardware. Before considering it done:

1. Walk the full flow on the iPad: login → permissions → home → patient search/create → consent → capture → analysis → results → back to home via each tab (Patients, Trends, Profile/Settings) → History via the "All sessions" link.
2. Confirm the idle-lock actually fires: leave the app foregrounded and untouched for 10+ minutes (or temporarily lower `IDLE_LOCK_MS` to 30s on-device to test faster, then revert), confirm it returns to login.
3. Confirm the AppState-based check: background the app, wait past the threshold, reopen — confirm it locks on reopen rather than waiting for the next 30s tick.
4. Re-read the design spec's substitution table against the final on-screen copy of every changed file, screen by screen. This is the single most important check in this plan — the easiest regression here is text quietly drifting back toward the source design's words.
5. `bash scripts/lint-claims.sh` one final time from the repo root.

## Done when

- `cd apps/mobile && npx jest` — 46 tests passing.
- `cd apps/mobile && npx tsc --noEmit` — clean.
- `bash scripts/lint-claims.sh` — clean.
- Every item in the Device verification section above confirmed on a physical device.
