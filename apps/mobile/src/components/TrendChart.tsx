import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedProps, useSharedValue, withDelay, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop } from "react-native-svg";
import { areaPath, axisLabels, CHART, chartPoints, linePath, pathLength } from "../lib/trendsData";
import { colors } from "../theme/colors";
import { EASE_OUT_EXPO } from "./FadeUp";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const GRID_Y = [20, 55, 90];
/** Above this many points the per-point dots would crowd the line, so only the last is drawn. */
const MAX_DOTS = 16;

/** The design's line + area chart (section 11) drawn from weekly counts. `counts` empty/all-zero draws only the grid. */
export function TrendChart({ counts }: { counts: number[] }) {
  const pts = chartPoints(counts);
  const len = pathLength(pts);
  const empty = counts.every((c) => c === 0);

  const draw = useSharedValue(len);
  const joint = useSharedValue(0);
  useEffect(() => {
    draw.value = len;
    draw.value = withDelay(250, withTiming(0, { duration: 1800, easing: EASE_OUT_EXPO }));
    joint.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [draw, joint, len, counts.length]);

  const lineProps = useAnimatedProps(() => ({ strokeDashoffset: draw.value }));
  const jointProps = useAnimatedProps(() => ({ r: 3.2 + 1.4 * joint.value, opacity: 0.45 + 0.55 * joint.value }));
  const last = pts[pts.length - 1];
  const labels = axisLabels(counts.length);

  return (
    <View>
      <Svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} width="100%" height={CHART.height} style={styles.svg}>
        <Defs>
          <LinearGradient id="ppGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.accent400} stopOpacity={0.38} />
            <Stop offset="1" stopColor={colors.accent400} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <G stroke={colors.bgDeep} strokeWidth={1}>
          {GRID_Y.map((y) => (
            <Line key={y} x1={0} y1={y} x2={CHART.width} y2={y} />
          ))}
        </G>
        {empty ? null : (
          <>
            <Path d={areaPath(pts)} fill="url(#ppGrad)" />
            <AnimatedPath
              d={linePath(pts)}
              fill="none"
              stroke={colors.accent600}
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={[len, len]}
              animatedProps={lineProps}
            />
            {pts.length <= MAX_DOTS ? (
              <G fill={colors.white} stroke={colors.accent600} strokeWidth={2.2}>
                {pts.slice(1, -1).map((p, i) => (
                  <Circle key={i} cx={p.x} cy={p.y} r={3.4} />
                ))}
              </G>
            ) : null}
            <AnimatedCircle cx={last.x} cy={last.y} fill={colors.accent600} animatedProps={jointProps} />
          </>
        )}
      </Svg>
      <View style={styles.axis}>
        {labels.map((l) => (
          <Text key={l} style={styles.axisText}>{l}</Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  svg: { marginTop: 14 },
  axis: { flexDirection: "row", justifyContent: "space-between" },
  axisText: { fontSize: 11, color: colors.textFaint },
});
