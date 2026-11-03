import { useEffect, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";

/** cubic-bezier(.22,1,.36,1) - the design's entrance curve (ppUp). */
export const EASE_OUT_EXPO = Easing.bezier(0.22, 1, 0.36, 1);
/** CSS `ease-out`. */
export const EASE_OUT = Easing.bezier(0, 0, 0.58, 1);

/** ppUp (distance 12) / ppIn (distance 0): fade in, optionally rising. Holds the start state until `delay` (fill-mode both). */
export function FadeUp({
  children, delay = 0, duration = 700, distance = 12, easing = EASE_OUT_EXPO, style,
}: {
  children?: ReactNode;
  /** ms */
  delay?: number;
  duration?: number;
  distance?: number;
  easing?: ReturnType<typeof Easing.bezier>;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withTiming(1, { duration, easing }));
  }, [t, delay, duration, easing]);
  const anim = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ translateY: (1 - t.value) * distance }],
  }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}
