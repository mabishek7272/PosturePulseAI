import type { TextStyle } from "react-native";
import { colors } from "./colors";

/** Type styles from the design (Inter / system). letterSpacing in px (em * size). */
export const type = {
  title: { fontSize: 21, fontWeight: "600", letterSpacing: -0.5, color: colors.text },
  headerTitle: { fontSize: 19, fontWeight: "600", letterSpacing: -0.48, color: colors.text },
  rowTitle: { fontSize: 14.5, fontWeight: "600", letterSpacing: -0.15, color: colors.text },
  body: { fontSize: 13, lineHeight: 19.5, color: colors.textBody },
  caption: { fontSize: 12, color: colors.textMuted },
  /** UPPERCASE small label, e.g. "STEP 2 OF 3". Apply `.toUpperCase()` to the string. */
  eyebrow: { fontSize: 11, fontWeight: "600", letterSpacing: 1.54, color: colors.accent600 },
  stat: { fontSize: 30, fontWeight: "600", letterSpacing: -1.2, color: colors.text },
  button: { fontSize: 15, fontWeight: "600", letterSpacing: 0.15, color: colors.accent100 },
} satisfies Record<string, TextStyle>;
