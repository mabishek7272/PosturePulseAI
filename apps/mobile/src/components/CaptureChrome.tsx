import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Circle, G, Line, Path } from "react-native-svg";
import { bodyGuideBox, GUIDE_VIEWBOX } from "../capture/body-guide";
import type { GuidanceCheck } from "../capture/guidance";
import { colors } from "../theme/colors";
import { BodyGuide } from "./BodyGuide";
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
  state, onPress, recordingStartedAt = null, totalSeconds = 0,
}: {
  state: "preparing" | "ready" | "recording";
  onPress: () => void;
  /** performance.now() at which recording began; draws the progress ring from real elapsed time. */
  recordingStartedAt?: number | null;
  totalSeconds?: number;
}) {
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
      {state === "recording" && recordingStartedAt !== null && totalSeconds > 0 ? (
        <ProgressRing startedAt={recordingStartedAt} totalSeconds={totalSeconds} />
      ) : null}
    </Pressable>
  );
}

/** Seconds elapsed since `startedAt` (performance.now(), monotonic), ticking every `intervalMs`; 0 when null. */
export function useElapsedSeconds(startedAt: number | null, intervalMs = 100): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (startedAt === null) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.max(0, (performance.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [startedAt, intervalMs]);
  return elapsed;
}

const RING_SIZE = 100;
const RING_R = 47;
const RING_C = 2 * Math.PI * RING_R;

/** Arc around the shutter: elapsed / total, from a monotonic clock. */
function ProgressRing({ startedAt, totalSeconds }: { startedAt: number; totalSeconds: number }) {
  const elapsed = useElapsedSeconds(startedAt);
  const p = Math.min(1, elapsed / totalSeconds);
  return (
    <Svg
      width={RING_SIZE} height={RING_SIZE} pointerEvents="none"
      style={{ position: "absolute", top: (82 - RING_SIZE) / 2, left: (82 - RING_SIZE) / 2 }}
    >
      <Circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R} stroke={colors.captureSegOff} strokeWidth={3} fill="none" />
      <Circle
        cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R} stroke={colors.accent400} strokeWidth={3.5} fill="none"
        strokeLinecap="round" strokeDasharray={`${RING_C} ${RING_C}`} strokeDashoffset={RING_C * (1 - p)}
        rotation={-90} origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
      />
    </Svg>
  );
}

/** Stop / discard glyph for the abandon-clip button. */
export function CloseGlyph({ size = 20, color = colors.accent300 }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round">
      <Path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

/**
 * AR framing cues over the camera: the see-through body outline (BodyGuide),
 * a centre line and a ground line at the feet. Neutral until every guidance
 * check passes, then violet-green. Aids framing only.
 */
export function ArTarget({ width, height, aligned, view }: { width: number; height: number; aligned: boolean; view: string }) {
  const box = bodyGuideBox(width, height);
  if (!box) return null;
  const stroke = aligned ? colors.captureAligned : colors.captureTargetIdle;
  const cx = box.x + box.w / 2;
  const feet = box.y + (232 / GUIDE_VIEWBOX.h) * box.h;
  const head = box.y + (6 / GUIDE_VIEWBOX.h) * box.h;
  return (
    <>
      <BodyGuide width={width} height={height} view={view} aligned={aligned} />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Line x1={cx} y1={head - 24} x2={cx} y2={feet + 8} stroke={stroke} strokeWidth={1} strokeDasharray="3 8" opacity={0.6} />
        <Line x1={cx - box.w * 0.6} y1={feet + 2} x2={cx + box.w * 0.6} y2={feet + 2} stroke={stroke} strokeWidth={aligned ? 2.2 : 1.4} strokeLinecap="round" opacity={0.8} />
      </Svg>
    </>
  );
}

/** Small round "i" button that toggles the full pose instruction. */
export function InfoButton({ open, onPress }: { open: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={open ? "Hide pose instructions" : "Show pose instructions"}
      accessibilityState={{ expanded: open }} onPress={onPress} hitSlop={10}
      style={[styles.info, open && styles.infoOpen]}
    >
      <Text style={styles.infoText}>i</Text>
    </Pressable>
  );
}

/** Small tick/dot chips for the guidance checks (compact: one wrapped row, 10 px text). */
export function GuidanceChips({ checks }: { checks: GuidanceCheck[] }) {
  return (
    <View style={styles.checks} accessibilityLabel={checks.map((c) => `${c.label} ${c.ok ? "ok" : "not yet"}`).join(", ")}>
      {checks.map((c) => (
        <View key={c.id} style={[styles.check, c.ok && styles.checkOk]}>
          <Text style={[styles.checkMark, c.ok && styles.checkMarkOk]}>{c.ok ? "✓" : "○"}</Text>
          <Text style={[styles.checkText, c.ok && styles.checkTextOk]}>{c.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Big 3-2-1 before the hold starts. */
export function CountdownOverlay({ value }: { value: number }) {
  return (
    <View style={styles.countdown} pointerEvents="none" accessibilityLiveRegion="polite" accessibilityLabel={`Starting in ${value}`}>
      <Text style={styles.countdownText}>{value}</Text>
      <Text style={styles.countdownHint}>Hold still. Recording starts now</Text>
    </View>
  );
}

/** Filled / empty stars for the per-pose card. */
export function Stars({ count }: { count: 1 | 2 | 3 }) {
  return (
    <Text style={styles.stars} accessibilityLabel={`${count} of 3 stars for capture quality`}>
      {[1, 2, 3].map((i) => (i <= count ? "★" : "☆")).join(" ")}
    </Text>
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
  info: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.captureRingButton },
  infoOpen: { backgroundColor: "rgba(255,255,255,0.18)" },
  infoText: { color: colors.accent300, fontSize: 13, fontWeight: "700", fontStyle: "italic" },
  checks: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  check: { flexDirection: "row", alignItems: "center", gap: 3, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 7, backgroundColor: colors.captureChip, opacity: 0.8 },
  checkOk: { opacity: 1, backgroundColor: "rgba(143,227,192,0.18)" },
  checkMark: { color: colors.captureGuide, fontSize: 9, fontWeight: "700" },
  checkMarkOk: { color: colors.captureAligned },
  checkText: { color: colors.captureGuide, fontSize: 10, fontWeight: "600" },
  checkTextOk: { color: colors.captureBody },
  countdown: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 10 },
  countdownText: { color: colors.accent100, fontSize: 132, fontWeight: "200", textShadowColor: colors.captureShutterGlow, textShadowRadius: 24 },
  countdownHint: { color: colors.captureBody, fontSize: 14, letterSpacing: 0.5 },
  stars: { color: colors.accent300, fontSize: 30, letterSpacing: 4 },
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
