/**
 * PosturePulse Pro palette (docs/superpowers/specs/2026-11-03-posturepulse-pro-reskin-design.md).
 * Every screen imports from here - no hex literal should appear in a
 * screen's StyleSheet after this reskin lands.
 */
export const colors = {
  // Light surfaces (the new default - replaces #0e0a16 as the app background)
  bg: "#f8f9ff",
  bgDeep: "#eef0fb",
  bgDark: "#17162a", // the few screens that stay dark intentionally: capture (camera visibility), analysis (matches source design)
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

  // Additional neutrals / dark-screen accents used by the design handoff
  white: "#ffffff",
  bgTint: "#f3f5fe", // pale chip / inset-button fill
  bgPage: "#eef0fb",
  textSecondary: "#595d6c", // icon buttons, secondary labels
  textBody: "#3f424d", // paragraph copy
  textDisabled: "#b2b6ca",
  accentSoft: "#b5afe8", // sub-copy on dark gradient cards
  darkAccentA: "#9690c9",
  darkAccentB: "#7972a9",
  darkSurface: "#2d2a44",
  scrim: "rgba(23,22,42,0.55)",

  // Glass surfaces (white, translucent) - pair with a blur
  glass: "rgba(255,255,255,0.74)",
  glassStrong: "rgba(255,255,255,0.8)",
  glassBar: "rgba(255,255,255,0.72)",
  glassHeader: "rgba(248,249,255,0.86)",
  glassTint: "rgba(245,244,255,0.85)",
  glassFooter: "rgba(245,244,255,0.8)",
  focusGlow: "rgba(181,171,252,0.16)",
  splashRingA: "rgba(181,171,252,0.5)",
  splashRingB: "rgba(181,171,252,0.35)",
  splashDisc: "rgba(255,255,255,0.08)",
  splashDiscRing: "rgba(210,206,253,0.35)",
  glassOnDark: "rgba(255,255,255,0.14)",
  glassOnDarkRing: "rgba(210,206,253,0.4)",
  barRing: "rgba(210,206,253,0.9)",
  accentRing: "rgba(121,108,191,0.5)",

  // Capture screen (camera overlay, section 07 of the design)
  captureScrim: "rgba(23,22,42,0.32)",
  captureGlass: "rgba(255,255,255,0.1)",
  captureGlassStrong: "rgba(255,255,255,0.12)",
  captureRing: "rgba(210,206,253,0.28)",
  captureRingSoft: "rgba(210,206,253,0.22)",
  captureRingButton: "rgba(210,206,253,0.24)",
  captureRingShutter: "rgba(210,206,253,0.4)",
  captureAccentPill: "rgba(121,108,191,0.3)",
  captureAccentPillRing: "rgba(181,171,252,0.45)",
  captureCard: "rgba(23,22,42,0.55)",
  captureChip: "rgba(181,171,252,0.16)",
  captureFrame: "rgba(181,171,252,0.28)",
  captureGuide: "#9690c9",
  captureSegOff: "rgba(210,206,253,0.25)",
  captureShutterRing: "rgba(181,171,252,0.55)",
  captureShutterGlow: "rgba(121,108,191,0.55)",
  captureScanClear: "rgba(181,171,252,0)",
  captureScanGlow: "rgba(181,171,252,0.5)",
  captureBody: "#f3f5fe",

  // Analysis screen (section 08, dark glass)
  analysisGlass: "rgba(255,255,255,0.06)",
  analysisGlassStrong: "rgba(255,255,255,0.08)",
  analysisGlassButton: "rgba(255,255,255,0.1)",
  analysisGlassDim: "rgba(255,255,255,0.03)",
  analysisRing: "rgba(210,206,253,0.16)",
  analysisRingDisc: "rgba(210,206,253,0.26)",
  analysisRingButton: "rgba(210,206,253,0.32)",
  analysisRingDim: "rgba(210,206,253,0.1)",
  analysisRingEmpty: "rgba(210,206,253,0.22)",
  analysisTrack: "rgba(210,206,253,0.14)",
  analysisTrackSmall: "rgba(210,206,253,0.25)",
  analysisHaloA: "rgba(181,171,252,0.3)",
  analysisHaloB: "rgba(181,171,252,0.2)",
  analysisActiveFill: "rgba(121,108,191,0.2)",
  analysisActiveRing: "rgba(181,171,252,0.42)",
  analysisTitle: "#f3f5fe",

  // Results screen (section 09)
  heroRingTrack: "rgba(210,206,253,0.2)",
  heroGlow: "rgba(181,171,252,0.42)",

  // Status (unchanged from P1 - no new semantics introduced)
  caution: "#ff6b6b",
} as const;

/** Gradient stop sets for expo-linear-gradient (`colors` prop). */
export const gradients = {
  primary: [colors.accent600, colors.accent700],
  primaryPressed: [colors.accent700, colors.accent800],
  /** Dark hero card (home "next session"). */
  hero: [colors.accent900, colors.accent800, colors.accent700],
  progress: [colors.accent600, colors.accent400],
  sheen: ["rgba(255,255,255,0)", "rgba(255,255,255,0.3)", "rgba(255,255,255,0)"],
} as const;
