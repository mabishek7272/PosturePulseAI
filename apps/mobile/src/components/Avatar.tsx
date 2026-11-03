import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";
import { colors, gradients } from "../theme/colors";
import { shadows } from "../theme/shadows";

export type AvatarVariant = "solid" | "soft" | "neutral";

export interface AvatarProps {
  initials: string;
  /** Edge length. Design uses 44 (home), 40 (consent), 38 (list rows). */
  size?: number;
  /** solid: violet gradient + white text. soft: lavender chip. neutral: pale grey chip. */
  variant?: AvatarVariant;
}

export function Avatar({ initials, size = 38, variant = "soft" }: AvatarProps) {
  const radius = Math.round(size * 0.32);
  const fontSize = size >= 44 ? 14 : size >= 40 ? 13 : 12.5;
  const label = initials.slice(0, 2).toUpperCase();
  const text = (
    <Text style={[styles.text, { fontSize, color: variant === "solid" ? colors.accent100 : variant === "soft" ? colors.accent700 : colors.textMuted }]}>
      {label}
    </Text>
  );
  if (variant === "solid") {
    return (
      <LinearGradient
        colors={gradients.primary}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.base, shadows.primary, { width: size, height: size, borderRadius: radius }]}
        accessibilityElementsHidden
      >
        {text}
      </LinearGradient>
    );
  }
  return (
    <View
      accessibilityElementsHidden
      style={[
        styles.base,
        { width: size, height: size, borderRadius: radius, backgroundColor: variant === "soft" ? colors.accent200 : colors.bgTint },
      ]}
    >
      {text}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  text: { fontWeight: "600", letterSpacing: 0.3 },
});
