import { parseBoolPref, serialiseBoolPref } from "./prefs";

describe("prefs", () => {
  it("round-trips booleans", () => {
    expect(parseBoolPref(serialiseBoolPref(true), false)).toBe(true);
    expect(parseBoolPref(serialiseBoolPref(false), true)).toBe(false);
  });
  it("falls back to the default for missing or corrupt values", () => {
    expect(parseBoolPref(null, true)).toBe(true);
    expect(parseBoolPref(undefined, false)).toBe(false);
    expect(parseBoolPref("yes", true)).toBe(true);
  });
});

describe("capture guidance pref", () => {
  const store: Record<string, string> = {};
  let prefs: typeof import("./prefs");
  beforeEach(() => {
    jest.resetModules();
    for (const k of Object.keys(store)) delete store[k];
    jest.doMock("expo-secure-store", () => ({
      getItemAsync: async (k: string) => store[k] ?? null,
      setItemAsync: async (k: string, v: string) => {
        store[k] = v;
      },
    }));
    prefs = require("./prefs");
  });
  it("defaults to on, and persists off independently of the skeleton pref", async () => {
    expect(await prefs.readCaptureGuidancePref()).toBe(true);
    await prefs.writeCaptureGuidancePref(false);
    expect(await prefs.readCaptureGuidancePref()).toBe(false);
    expect(await prefs.readSkeletonOverlayPref()).toBe(true);
  });
  it("falls back to on when storage throws", async () => {
    jest.doMock("expo-secure-store", () => ({
      getItemAsync: async () => {
        throw new Error("no");
      },
      setItemAsync: async () => {},
    }));
    jest.resetModules();
    expect(await require("./prefs").readCaptureGuidancePref()).toBe(true);
  });
});

describe("haptic feedback pref", () => {
  const store: Record<string, string> = {};
  let prefs: typeof import("./prefs");
  beforeEach(() => {
    jest.resetModules();
    for (const k of Object.keys(store)) delete store[k];
    jest.doMock("expo-secure-store", () => ({
      getItemAsync: async (k: string) => store[k] ?? null,
      setItemAsync: async (k: string, v: string) => {
        store[k] = v;
      },
    }));
    prefs = require("./prefs");
  });
  it("defaults to on, persists off, and is independent of the other prefs", async () => {
    expect(await prefs.readHapticFeedbackPref()).toBe(true);
    await prefs.writeHapticFeedbackPref(false);
    expect(await prefs.readHapticFeedbackPref()).toBe(false);
    expect(await prefs.readCaptureGuidancePref()).toBe(true);
    expect(await prefs.readSkeletonOverlayPref()).toBe(true);
  });
  it("falls back to on when storage throws", async () => {
    jest.doMock("expo-secure-store", () => ({
      getItemAsync: async () => {
        throw new Error("no");
      },
      setItemAsync: async () => {},
    }));
    jest.resetModules();
    expect(await require("./prefs").readHapticFeedbackPref()).toBe(true);
  });
});
