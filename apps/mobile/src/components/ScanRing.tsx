import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { formatRemaining } from "../capture/sqi";
import { colors } from "../theme/colors";
import { useElapsedSeconds } from "./CaptureChrome";

/** Ring diameter for the window: ~21% of height, clamped to 120-180 so it fits small phones and iPads. */
export function ringSize(winH: number): number {
  return Math.round(Math.min(180, Math.max(120, winH * 0.21)));
}

const capSize = (size: number) => Math.max(8, Math.min(12, Math.round(size * 0.075)));

/**
 * Large progress ring shown during the 3-2-1 countdown and the hold. The arc is
 * elapsed / totalSeconds from a monotonic clock; the numerals are the time left.
 * Sits on a dark translucent disc so it reads over a busy camera image.
 */
export function ScanRing({
  size, startedAt, totalSeconds, countdown, tone = "violet", caption,
}: {
  size: number; startedAt: number | null; totalSeconds: number; countdown: number | null;
  /** amber = a filming condition needs attention; green = flash after it recovers. */
  tone?: "violet" | "amber" | "green";
  /** Replaces "Hold still" under the time while set. */
  caption?: string | null;
}) {
  const arc = tone === "amber" ? colors.captureAmber : tone === "green" ? colors.captureAligned : colors.accent400;
  const capColor = tone === "amber" ? colors.captureAmber : tone === "green" ? colors.captureAligned : colors.accent300;
  const elapsed = useElapsedSeconds(startedAt);
  const stroke = Math.max(9, Math.round(size * 0.07));
  const r = (size - stroke) / 2 - 4;
  const c = 2 * Math.PI * r;
  const p = startedAt === null ? 0 : Math.min(1, elapsed / totalSeconds);
  const remaining = formatRemaining(elapsed, totalSeconds);
  const label = countdown !== null ? `Starting in ${countdown}` : `${remaining} remaining`;
  return (
    <View style={{ width: size, height: size, alignSelf: "center" }} pointerEvents="none" accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="ringArc" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#ffffff" />
            <Stop offset="1" stopColor={arc} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill="rgba(10,8,24,0.62)" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.18)" strokeWidth={stroke} fill="none" />
        {p > 0 ? (
          <>
            <Circle
              cx={size / 2} cy={size / 2} r={r} stroke={arc} strokeOpacity={0.35} strokeWidth={stroke + 8} fill="none"
              strokeLinecap="round" strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - p)}
              rotation={-90} origin={`${size / 2}, ${size / 2}`}
            />
            <Circle
              cx={size / 2} cy={size / 2} r={r} stroke="url(#ringArc)" strokeWidth={stroke} fill="none"
              strokeLinecap="round" strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - p)}
              rotation={-90} origin={`${size / 2}, ${size / 2}`}
            />
          </>
        ) : null}
      </Svg>
      <View style={styles.inner}>
        {countdown !== null ? (
          <>
            <Text style={[styles.big, { fontSize: size * 0.42 }]}>{countdown}</Text>
            <Text style={[styles.cap, { fontSize: capSize(size) }]}>Get ready</Text>
          </>
        ) : (
          <>
            <Text style={[styles.big, { fontSize: size * 0.26 }]}>{remaining}</Text>
            <Text style={[styles.cap, { color: capColor, fontSize: capSize(size) }]} numberOfLines={2}>{caption ?? "Hold still"}</Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inner: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  big: { color: colors.white, fontWeight: "300", fontVariant: ["tabular-nums"], textShadowColor: colors.captureShutterGlow, textShadowRadius: 12 },
  cap: { textAlign: "center", paddingHorizontal: 6, color: colors.accent300, fontSize: 12, fontWeight: "600", letterSpacing: 0.6, marginTop: 2 },
});
