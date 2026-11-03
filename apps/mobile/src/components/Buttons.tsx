import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, gradients } from "../theme/colors";
import { radii } from "../theme/radii";
import { shadows } from "../theme/shadows";
import { type } from "../theme/typography";

interface ButtonBase {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Optional icon rendered before the label. */
  icon?: ReactNode;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Violet gradient button. `height` 52 (login), 54 (footer CTAs); radius 13/14. */
export function PrimaryButton({
  label, onPress, disabled, loading, icon, accessibilityLabel, style, height = 54,
}: ButtonBase & { height?: number }) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [shadows.primary, { borderRadius: radii.lg - 2, opacity: off ? 0.5 : 1 }, pressed && { transform: [{ scale: 0.985 }] }, style]}
    >
      {({ pressed }) => (
        <LinearGradient
          colors={pressed ? gradients.primaryPressed : gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.fill, { height, borderRadius: radii.lg - 2 }]}
        >
          {loading ? <ActivityIndicator color={colors.accent100} /> : (
            <View style={styles.content}>
              {icon}
              <Text style={type.button}>{label}</Text>
            </View>
          )}
        </LinearGradient>
      )}
    </Pressable>
  );
}

/** Lavender outlined button (height 50, 14/500). */
export function SecondaryButton({
  label, onPress, disabled, loading, icon, accessibilityLabel, style, height = 50,
}: ButtonBase & { height?: number }) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fill,
        styles.secondary,
        { height, backgroundColor: pressed ? colors.accent200 : colors.accent100, opacity: off ? 0.5 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={colors.accent700} /> : (
        <View style={styles.content}>
          {icon}
          <Text style={styles.secondaryLabel}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  secondary: { borderRadius: radii.button, borderWidth: 1, borderColor: colors.accent300 },
  secondaryLabel: { fontSize: 14, fontWeight: "500", color: colors.accent700 },
});
