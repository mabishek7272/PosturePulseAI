import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "../theme/colors";
import { radii } from "../theme/radii";
import { shadows } from "../theme/shadows";

export interface GlassCardProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Fill colour over the blur. Default: white 0.74 alpha. */
  fill?: string;
  /** 1px ring colour. Default #e4e7f5 (use accent200/300 for tinted cards). */
  ring?: string;
  radius?: number;
  /** Blur strength (CSS px blur ~ intensity). 0 disables the blur. */
  intensity?: number;
  elevated?: boolean;
  /** Blur tint; "dark" for cards over the camera. Default light. */
  tint?: "light" | "dark";
}

/**
 * Translucent blurred card with a 1px ring and soft shadow. Uses BlurView on
 * iOS; Android falls back to a more opaque solid fill.
 */
export function GlassCard({
  children,
  style,
  fill = colors.glass,
  ring = colors.hairline,
  radius = radii.card,
  intensity = 40,
  elevated = true,
  tint = "light",
}: GlassCardProps) {
  const blur = intensity > 0 && Platform.OS === "ios";
  return (
    <View style={[elevated && shadows.card, { borderRadius: radius }, style]}>
      <View style={[styles.clip, { borderRadius: radius, backgroundColor: blur ? undefined : tint === "dark" ? colors.captureCard : colors.glassStrong }]}>
        {blur ? <BlurView intensity={intensity} tint={tint} style={StyleSheet.absoluteFill} /> : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: blur ? fill : "transparent" }]} />
        {children}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.ring, { borderRadius: radius, borderColor: ring }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  ring: { borderWidth: 1 },
});
