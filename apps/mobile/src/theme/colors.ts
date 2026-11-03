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
  glassOnDark: "rgba(255,255,255,0.14)",
  glassOnDarkRing: "rgba(210,206,253,0.4)",
  barRing: "rgba(210,206,253,0.9)",
  accentRing: "rgba(121,108,191,0.5)",

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
