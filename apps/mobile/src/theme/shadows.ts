import type { ViewStyle } from "react-native";
import { colors } from "./colors";

/** Elevation presets taken from the design's box-shadow values. */
type Shadow = Pick<ViewStyle, "shadowColor" | "shadowOpacity" | "shadowRadius" | "shadowOffset" | "elevation">;

export const shadows = {
  /** Cards: 0 8px 22px rgba(22,24,38,.05) */
  card: { shadowColor: colors.text, shadowOpacity: 0.05, shadowRadius: 11, shadowOffset: { width: 0, height: 8 }, elevation: 2 },
  /** Tab bar: 0 14px 34px rgba(22,24,38,.12) */
  bar: { shadowColor: colors.text, shadowOpacity: 0.12, shadowRadius: 17, shadowOffset: { width: 0, height: 14 }, elevation: 8 },
  /** Primary button: 0 10px 26px rgba(93,82,148,.32) */
  primary: { shadowColor: colors.accent700, shadowOpacity: 0.32, shadowRadius: 13, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  /** Raised camera button: 0 10px 24px rgba(93,82,148,.42) */
  fab: { shadowColor: colors.accent700, shadowOpacity: 0.42, shadowRadius: 12, shadowOffset: { width: 0, height: 10 }, elevation: 10 },
  /** Dark hero card: 0 16px 36px rgba(43,39,65,.3) */
  hero: { shadowColor: colors.accent900, shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 16 }, elevation: 8 },
  /** Switch thumb */
  thumb: { shadowColor: colors.text, shadowOpacity: 0.22, shadowRadius: 1.5, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
} satisfies Record<string, Shadow>;
