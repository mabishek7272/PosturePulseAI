import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { type } from "../theme/typography";
import { BackIcon } from "./icons";

export interface ScreenHeaderProps {
  title: string;
  /** e.g. "Step 2 of 3" - rendered uppercase above the title. */
  eyebrow?: string;
  /** Right-aligned slot (action button, etc). Ignored when `step` is set. */
  right?: ReactNode;
  /** 3-dash step indicator: `{ current: 2, total: 3 }` fills the first two. */
  step?: { current: number; total: number };
  /** Defaults to router.back(). Pass null to hide the back button. */
  onBack?: (() => void) | null;
  /** Back button fill: white (patients list) or pale tint (consent). */
  backVariant?: "white" | "tint";
  /** Top padding; the design uses 58 below the status bar. Pass safe-area top + ~14. */
  paddingTop?: number;
}

export function StepBar({ current, total }: { current: number; total: number }) {
  return (
    <View style={styles.steps}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.dash, { backgroundColor: i < current ? colors.accent600 : colors.hairline }]} />
      ))}
    </View>
  );
}

export function BackButton({ onPress, variant = "white" }: { onPress?: () => void; variant?: "white" | "tint" }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      onPress={onPress ?? (() => router.back())}
      style={({ pressed }) => [
        styles.back,
        variant === "white" ? styles.backWhite : styles.backTint,
        pressed && { backgroundColor: colors.accent200 },
      ]}
    >
      <BackIcon size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

export function ScreenHeader({
  title,
  eyebrow,
  right,
  step,
  onBack,
  backVariant = "white",
  paddingTop = 58,
}: ScreenHeaderProps) {
  return (
    <View style={[styles.row, { paddingTop }]}>
      {onBack === null ? null : <BackButton onPress={onBack} variant={backVariant} />}
      <View style={styles.titles}>
        {eyebrow ? <Text style={type.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
        <Text accessibilityRole="header" style={eyebrow ? type.headerTitle : type.title}>
          {title}
        </Text>
      </View>
      <View style={styles.right}>{step ? <StepBar {...step} /> : right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 14 },
  titles: { gap: 2, flexShrink: 1 },
  right: { marginLeft: "auto" },
  back: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  backWhite: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline },
  backTint: { backgroundColor: colors.bgTint, borderWidth: 1, borderColor: colors.hairline },
  steps: { flexDirection: "row", gap: 4 },
  dash: { width: 22, height: 4, borderRadius: 2 },
});
