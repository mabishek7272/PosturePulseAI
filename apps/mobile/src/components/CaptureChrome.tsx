import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { G, Line } from "react-native-svg";
import { colors } from "../theme/colors";
import { RingPulse } from "./Motion";

/** Translucent rounded glass chip/button over the camera (design: blur 16, 1px inset ring). */
export function CaptureGlass({
  children, style, fill = colors.captureGlass, ring = colors.captureRing, radius, intensity = 30,
}: { children?: ReactNode; style?: StyleProp<ViewStyle>; fill?: string; ring?: string; radius: number; intensity?: number }) {
  return (
    <View style={[{ borderRadius: radius, overflow: "hidden" }, style]}>
      {Platform.OS === "ios" ? <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
      {children}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1, borderColor: ring }]} />
    </View>
  );
}

/** Square 48px glass button (design: grid / refresh). */
export function SquareGlassButton({
  children, disabled, onPress, label,
}: { children: ReactNode; disabled?: boolean; onPress?: () => void; label: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={disabled ? styles.disabled : undefined}>
      <CaptureGlass radius={15} ring={colors.captureRingButton} style={styles.square}>
        <View style={styles.center}>{children}</View>
      </CaptureGlass>
    </Pressable>
  );
}

/** Big ringed shutter: gradient core, pulsing ring (ppRing). */
export function Shutter({
  state, onPress,
}: { state: "preparing" | "ready" | "recording"; onPress: () => void }) {
  const label = state === "recording" ? "Recording" : state === "preparing" ? "Preparing camera" : "Start recording this pose";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: state !== "ready", busy: state !== "ready" }}
      disabled={state !== "ready"}
      onPress={onPress}
    >
      <CaptureGlass radius={41} fill={colors.captureGlassStrong} ring={colors.captureRingShutter} intensity={40} style={[styles.shutter, state === "preparing" && styles.disabled]}>
        <View style={styles.center}>
          <LinearGradient
            colors={[colors.accent400, colors.accent600]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.core, state === "recording" && styles.coreRecording]}
          />
        </View>
      </CaptureGlass>
      {state !== "preparing" ? <RingPulse duration={2600} style={styles.ring} /> : null}
    </Pressable>
  );
}

/** ppScan: a glowing line sweeping top to bottom (60 -> 640 of an 844pt screen). */
export function ScanLine({ height }: { height: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 3600, easing: Easing.bezier(0.45, 0, 0.55, 1) }), -1, false);
  }, [t]);
  const anim = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.12, 0.88, 1], [0, 1, 1, 0]),
    transform: [{ translateY: interpolate(t.value, [0, 1], [(60 / 844) * height, (640 / 844) * height]) }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.scan, anim]}>
      <LinearGradient colors={[colors.captureScanClear, colors.captureScanGlow, colors.captureScanClear]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.scanGlow} />
      <LinearGradient
        colors={[colors.captureScanClear, colors.accent400, colors.captureScanClear]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.scanLine}
      />
    </Animated.View>
  );
}

/** Dashed centre cross guides, laid out from the design's 390x844 artboard. */
export function CentreGuides({ width, height }: { width: number; height: number }) {
  const sx = width / 390;
  const sy = height / 844;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <G opacity={0.3} stroke={colors.captureGuide} strokeWidth={0.6}>
        <Line x1={195 * sx} y1={130 * sy} x2={195 * sx} y2={720 * sy} strokeDasharray="4 7" />
        <Line x1={60 * sx} y1={425 * sy} x2={330 * sx} y2={425 * sy} strokeDasharray="4 7" />
      </G>
    </Svg>
  );
}

/** FRONT / LEFT / RIGHT / BACK progress; completed and current segments are filled. */
export function ViewProgress({ labels, current }: { labels: string[]; current: number }) {
  return (
    <View style={styles.progress} accessibilityRole="progressbar" accessibilityLabel={`View ${current + 1} of ${labels.length}`}>
      {labels.map((l, i) => (
        <View key={l} style={styles.seg}>
          <View style={[styles.segBar, { backgroundColor: i <= current ? colors.accent400 : colors.captureSegOff }]} />
          <Text style={[styles.segLabel, { color: i <= current ? colors.accent300 : colors.captureGuide }]}>{l}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.4 },
  square: { width: 48, height: 48 },
  shutter: { width: 82, height: 82 },
  core: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: colors.accent600,
    shadowColor: colors.accent600, shadowOpacity: 0.55, shadowRadius: 12, shadowOffset: { width: 0, height: 8 },
  },
  coreRecording: { width: 30, height: 30, borderRadius: 9 },
  ring: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 41, borderWidth: 1, borderColor: colors.captureShutterRing },
  scan: { position: "absolute", left: 0, right: 0, top: 0, height: 2 },
  scanLine: { height: 2 },
  scanGlow: { position: "absolute", left: 0, right: 0, top: -12, height: 26 },
  progress: { flexDirection: "row", gap: 7, marginTop: 14 },
  seg: { flex: 1, gap: 6 },
  segBar: { height: 3, borderRadius: 2 },
  segLabel: { fontSize: 10, fontWeight: "600", letterSpacing: 0.6 },
});
