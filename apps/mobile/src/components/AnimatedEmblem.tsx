import { useEffect } from "react";
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { EMBLEM, EMBLEM_ASPECT } from "./LogoMark";

/**
 * The PosturePulse emblem with an entrance: springs up from 70 % while it fades
 * and untwists, then (optionally) floats gently with a soft glow pulse behind
 * it. Honours Reduce Motion: the emblem simply appears.
 */
export function AnimatedEmblem({
  width, delay = 0, float = false, glowColor, style,
}: {
  width: number;
  /** ms before the entrance starts. */
  delay?: number;
  /** Keep a slow idle float after the entrance. */
  float?: boolean;
  /** Colour of the pulsing halo; none when omitted. */
  glowColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReducedMotion();
  const enter = useSharedValue(reduce ? 1 : 0);
  const bob = useSharedValue(0);
  const glow = useSharedValue(0);

  useEffect(() => {
    if (reduce) return;
    enter.value = withDelay(delay, withSpring(1, { damping: 11, stiffness: 120, mass: 0.9 }));
    if (float) {
      bob.value = withDelay(
        delay + 700,
        withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true),
      );
    }
    if (glowColor) {
      glow.value = withDelay(
        delay + 300,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: 1400, easing: Easing.in(Easing.quad) }),
          ),
          -1,
        ),
      );
    }
  }, [reduce, delay, float, glowColor, enter, bob, glow]);

  const emblem = useAnimatedStyle(() => ({
    opacity: Math.min(1, enter.value * 1.4),
    transform: [
      { translateY: -3 * bob.value },
      { scale: 0.7 + 0.3 * enter.value },
      { rotate: `${(1 - enter.value) * -10}deg` },
    ],
  }));
  const halo = useAnimatedStyle(() => ({
    opacity: 0.15 + 0.35 * glow.value,
    transform: [{ scale: 0.92 + 0.12 * glow.value }],
  }));

  const height = width / EMBLEM_ASPECT;
  return (
    <View style={[{ width, height, alignItems: "center", justifyContent: "center" }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {glowColor ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.halo, { width: width * 1.15, height: width * 1.15, borderRadius: width, backgroundColor: glowColor }, halo]}
        />
      ) : null}
      <Animated.View style={emblem}>
        <Image source={EMBLEM} style={{ width, height }} resizeMode="contain" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  halo: { position: "absolute" },
});
