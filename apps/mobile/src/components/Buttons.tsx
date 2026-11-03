import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
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

/** ppSheen: a skewed white highlight sweeping across the button every 3.4s. */
function Sheen({ width }: { width: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 3400, easing: Easing.inOut(Easing.ease) }), -1, false);
  }, [t]);
  const bar = width * 0.38;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: bar * (-1.4 + 4 * t.value) }, { skewX: "-18deg" }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.sheen, { width: bar }, style]}>
      <LinearGradient colors={gradients.sheen} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

/** Violet gradient button. `height` 52 (login), 54 (footer CTAs); radius 13/14. */
export function PrimaryButton({
  label, onPress, disabled, loading, icon, accessibilityLabel, style, height = 54, radius = radii.lg - 2, sheen = false,
}: ButtonBase & { height?: number; radius?: number; sheen?: boolean }) {
  const off = disabled || loading;
  const [w, setW] = useState(0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [shadows.primary, { borderRadius: radius, opacity: off ? 0.5 : 1 }, pressed && { transform: [{ scale: 0.985 }] }, style]}
    >
      {({ pressed }) => (
        <LinearGradient
          colors={pressed ? gradients.primaryPressed : gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          onLayout={(e) => setW(e.nativeEvent.layout.width)}
          style={[styles.fill, { height, borderRadius: radius, overflow: "hidden" }]}
        >
          {sheen && !off && w > 0 ? <Sheen width={w} /> : null}
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
  sheen: { position: "absolute", top: 0, bottom: 0, left: 0 },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  secondary: { borderRadius: radii.button, borderWidth: 1, borderColor: colors.accent300 },
  secondaryLabel: { fontSize: 14, fontWeight: "500", color: colors.accent700 },
});
