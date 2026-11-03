import { useEffect, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { EASE_OUT_EXPO } from "./FadeUp";

/** ppSpin: continuous 360deg rotation. */
export function Spin({ duration, children, style }: { duration: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false);
  }, [t, duration]);
  const anim = useAnimatedStyle(() => ({ transform: [{ rotate: `${t.value * 360}deg` }] }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/** ppType: a dot that lifts 4px and brightens (.3 -> 1 at 40%) over 1.2s. */
export function TypeDot({ delay = 0, style }: { delay?: number; style?: StyleProp<ViewStyle> }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 480, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 720, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      ),
    );
  }, [t, delay]);
  const anim = useAnimatedStyle(() => ({ opacity: 0.3 + 0.7 * t.value, transform: [{ translateY: -4 * t.value }] }));
  return <Animated.View style={[style, anim]} />;
}

/** ppDot: opacity .22 -> 1 (at 38%) -> .22 over 1.8s, looping. */
export function PulseDot({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useSharedValue(0.22);
  useEffect(() => {
    t.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 684, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.22, { duration: 1116, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [t]);
  const anim = useAnimatedStyle(() => ({ opacity: t.value }));
  return <Animated.View style={[style, anim]} />;
}

/** ppBar: scaleY .08 -> 1 anchored at the bottom (transform-origin: bottom). */
export function GrowBar({ height, delay, style }: { height: number; delay: number; style?: StyleProp<ViewStyle> }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withTiming(1, { duration: 700, easing: EASE_OUT_EXPO }));
  }, [t, delay]);
  const anim = useAnimatedStyle(() => {
    const s = 0.08 + 0.92 * t.value;
    // RN scales about the centre; shift down by h(1-s)/2 to anchor the bottom.
    return { transform: [{ translateY: (height * (1 - s)) / 2 }, { scaleY: s }] };
  });
  return <Animated.View style={[style, { height }, anim]} />;
}

/** ppWidth: 0 -> pct% over 1.2s. */
export function GrowWidth({ pct, delay = 300, style, children }: { pct: number; delay?: number; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withTiming(pct, { duration: 1200, easing: EASE_OUT_EXPO }));
  }, [t, pct, delay]);
  const anim = useAnimatedStyle(() => ({ width: `${t.value}%` }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/** ppRing: a ring that scales .8 -> 1.65 and fades .5 -> 0 over the first 70% of the cycle. */
export function RingPulse({ duration, delay = 0, style }: { duration: number; delay?: number; style?: StyleProp<ViewStyle> }) {
  // A delayed ring rests invisible (end state) until its first cycle starts.
  const t = useSharedValue(delay > 0 ? 1 : 0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.out(Easing.ease) }), -1, false));
  }, [t, duration, delay]);
  const anim = useAnimatedStyle(() => {
    const k = Math.min(t.value / 0.7, 1);
    return { opacity: 0.5 * (1 - k), transform: [{ scale: 0.8 + 0.85 * k }] };
  });
  return <Animated.View pointerEvents="none" style={[style, anim]} />;
}
