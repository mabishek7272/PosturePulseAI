import { useEffect } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { colors } from "../theme/colors";

export interface BlobSpec {
  size: number;
  /** Offsets from the container edges; supply any of left/right/top/bottom. */
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  color: string;
  /** Seconds for one drift cycle. */
  duration: number;
  /** ppDrift (translate 20,-26 scale 1.14) vs ppDrift2 (-24,18 scale .92). */
  variant?: 1 | 2;
  opacity?: number;
}

/** Light-screen blob (home/most light screens). */
export const LIGHT_BLOBS: BlobSpec[] = [
  { size: 400, left: -60, top: -110, color: colors.accent300, duration: 20 },
];
/** Dark-screen blobs (splash). */
export const DARK_BLOBS: BlobSpec[] = [
  { size: 420, left: -120, top: 120, color: colors.accent700, duration: 14 },
  { size: 360, right: -110, top: 380, color: colors.accent600, duration: 17, variant: 2 },
];

function Blob({ spec, reduceMotion }: { spec: BlobSpec; reduceMotion: boolean }) {
  const t = useSharedValue(0);
  const v2 = spec.variant === 2;
  useEffect(() => {
    if (reduceMotion) return;
    t.value = withRepeat(
      withTiming(1, { duration: (spec.duration * 1000) / 2, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [t, spec.duration, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: (v2 ? -24 : 20) * t.value },
      { translateY: (v2 ? 18 : -26) * t.value },
      { scale: v2 ? 1.05 - 0.13 * t.value : 1 + 0.14 * t.value },
    ],
  }));

  const pos: ViewStyle = { left: spec.left, right: spec.right, top: spec.top, bottom: spec.bottom };
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.blob, pos, { width: spec.size, height: spec.size, opacity: spec.opacity ?? 1 }, style]}
    >
      <Svg width={spec.size} height={spec.size}>
        <Defs>
          <RadialGradient id="g" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={spec.color} stopOpacity={1} />
            <Stop offset="0.7" stopColor={spec.color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={spec.size / 2} cy={spec.size / 2} r={spec.size / 2} fill="url(#g)" />
      </Svg>
    </Animated.View>
  );
}

/**
 * Slowly drifting radial-gradient blobs behind screen content (ppDrift).
 * Place as the first child of a screen root; it is non-interactive.
 */
export function DriftingBlobs({
  blobs = LIGHT_BLOBS,
  reduceMotion = false,
}: {
  blobs?: BlobSpec[];
  reduceMotion?: boolean;
}) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {blobs.map((b, i) => (
        <Blob key={i} spec={b} reduceMotion={reduceMotion} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ blob: { position: "absolute" } });
