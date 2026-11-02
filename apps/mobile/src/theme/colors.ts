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

  // Status (unchanged from P1 - no new semantics introduced)
  caution: "#ff6b6b",
} as const;
