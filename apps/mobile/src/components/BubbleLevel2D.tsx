import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, Ellipse, Line, RadialGradient, Stop } from "react-native-svg";
import { bubbleOffset, bubbleTone, toleranceZone, type BubbleTone } from "../capture/bubble";
import { directionWordX, directionWordY, formatSigned } from "../capture/level";
import { colors } from "../theme/colors";

const TONE: Record<BubbleTone, { core: string; edge: string; zone: string }> = {
  green: { core: "#c9f5e1", edge: colors.captureAligned, zone: "rgba(143,227,192,0.30)" },
  amber: { core: "#ffe3a8", edge: colors.captureAmber, zone: "rgba(143,227,192,0.18)" },
  grey: { core: "#d5d6de", edge: "#8d90a0", zone: "rgba(143,227,192,0.10)" },
};

/**
 * Round 2-axis bubble level (left outer column). The bubble moves toward the HIGH side like a real
 * vial: tilt left-right on the horizontal axis, forward-back on the vertical axis, 10 degrees per
 * axis to the rim (see capture/bubble.ts). The green ellipse is the tolerance zone (3 degrees
 * left-right, 5 degrees forward-back, same scaling). Describes the DEVICE's tilt only.
 */
export function BubbleLevel2D({
  x, y, level, size, width, compact = false,
}: {
  x: number | null; y: number | null; level: boolean;
  /** Vial diameter, px. */
  size: number;
  /** Width of the whole widget (readouts), px. */
  width: number;
  /** Smaller text block while recording. */
  compact?: boolean;
}) {
  const c = size / 2;
  const rim = c - 2;
  const br = Math.max(7, size * 0.12);
  const travel = rim - br - 1;
  const { dx, dy } = bubbleOffset(x, y, travel);
  const zone = toleranceZone(travel);
  const tone = bubbleTone(x, y, level);
  const t = TONE[tone];
  const wordX = directionWordX(x);
  const wordY = directionWordY(y);
  const word = [wordX, wordY].filter(Boolean).join(" · ");
  const status = tone === "grey" ? "No reading" : level ? "Level" : "Tilted";
  const label = `Tilt: left-right ${formatSigned(x)}, forward-back ${formatSigned(y)}. ${status}.`;
  const fs = compact ? 10 : 11;
  return (
    <View style={{ width, alignItems: "center" }} pointerEvents="none" accessible accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="vialGlass" cx="50%" cy="40%" r="65%">
            <Stop offset="0" stopColor="#2a2845" stopOpacity={0.9} />
            <Stop offset="1" stopColor="#0b0a1a" stopOpacity={0.88} />
          </RadialGradient>
          <RadialGradient id="vialBubble" cx="38%" cy="34%" r="70%">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0.95} />
            <Stop offset="0.35" stopColor={t.core} stopOpacity={0.95} />
            <Stop offset="1" stopColor={t.edge} stopOpacity={0.85} />
          </RadialGradient>
        </Defs>
        <Circle cx={c} cy={c} r={rim} fill="url(#vialGlass)" stroke="rgba(210,206,253,0.5)" strokeWidth={1.5} />
        <Ellipse cx={c} cy={c} rx={zone.rx} ry={zone.ry} fill={t.zone} stroke={colors.captureAligned} strokeOpacity={0.7} strokeWidth={1} />
        {[1 / 3, 2 / 3, 1].map((f) => (
          <Circle key={f} cx={c} cy={c} r={travel * f} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={0.8} />
        ))}
        <Line x1={c - rim} y1={c} x2={c + rim} y2={c} stroke="rgba(255,255,255,0.28)" strokeWidth={0.8} />
        <Line x1={c} y1={c - rim} x2={c} y2={c + rim} stroke="rgba(255,255,255,0.28)" strokeWidth={0.8} />
        <Circle cx={c + dx} cy={c + dy} r={br + 3} fill={t.edge} opacity={0.22} />
        <Circle cx={c + dx} cy={c + dy} r={br} fill="url(#vialBubble)" stroke={t.edge} strokeWidth={1} />
      </Svg>
      <View style={styles.text}>
        <Text style={[styles.num, { fontSize: fs }]} numberOfLines={1}>{`L–R  ${formatSigned(x)}`}</Text>
        <Text style={[styles.num, { fontSize: fs }]} numberOfLines={1}>{`F–B  ${formatSigned(y)}`}</Text>
        <Text style={[styles.word, { fontSize: fs - 1 }]} numberOfLines={2}>{word || (tone === "grey" ? "Hold upright" : " ")}</Text>
        <View style={[styles.badge, { borderColor: t.edge, backgroundColor: tone === "green" ? "rgba(143,227,192,0.18)" : "rgba(0,0,0,0.25)" }]}>
          <Text style={[styles.badgeText, { color: t.edge }]}>{status}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  text: { marginTop: 5, alignItems: "center", gap: 1, minHeight: 56 },
  num: { color: colors.white, fontWeight: "600", fontVariant: ["tabular-nums"], textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 },
  word: { color: colors.accent100, textAlign: "center", fontWeight: "500", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 },
  badge: { marginTop: 3, paddingHorizontal: 8, paddingVertical: 1, borderRadius: 8, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
});
