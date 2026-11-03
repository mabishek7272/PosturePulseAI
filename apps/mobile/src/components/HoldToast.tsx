import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";

export interface ToastMessage {
  /** Changes for every new message; a new id replaces the current toast. */
  id: number;
  text: string;
  tone: "warn" | "good";
}

/** How long a toast stays before it dismisses itself. */
export const TOAST_MS = 2000;

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => live && setReduce(v)).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/**
 * Small pill near the top-centre of the camera view: a short plain instruction
 * (amber) or "Good" (green). Fades/slides in, dismisses itself after ~2 s, and a
 * new message replaces the current one. Reduce-motion: fade only, no slide.
 */
export function HoldToast({ toast }: { toast: ToastMessage | null }) {
  const reduce = useReduceMotion();
  const [shown, setShown] = useState<ToastMessage | null>(null);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!toast) {
      setShown(null);
      anim.setValue(0);
      return;
    }
    setShown(toast);
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: reduce ? 0 : 180, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: reduce ? 0 : 220, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setShown(null);
      });
    }, TOAST_MS);
    return () => {
      clearTimeout(t);
      anim.stopAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.id]);

  if (!shown) return null;
  const warn = shown.tone === "warn";
  const slide = reduce ? 0 : anim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] });
  return (
    <View style={styles.anchor} pointerEvents="none">
      <Animated.View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={shown.text}
        style={[
          styles.pill,
          warn ? styles.warn : styles.good,
          { opacity: anim, transform: [{ translateY: slide }] },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: warn ? colors.captureAmber : colors.captureAligned }]} />
        <Text style={[styles.text, { color: warn ? colors.captureAmber : colors.captureAligned }]} numberOfLines={1}>{shown.text}</Text>
      </Animated.View>
    </View>
  );
}

/**
 * Thin full-screen edge glow: amber while a warning is unresolved (gentle pulse
 * unless reduce-motion), green for the one-off "recovered" flash.
 */
export function EdgeGlow({ mode }: { mode: "none" | "amber" | "green" }) {
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (mode !== "amber" || reduce) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [mode, reduce, pulse]);
  if (mode === "none") return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.glow,
        { borderColor: mode === "amber" ? colors.captureAmberSoft : colors.captureAlignedSoft, opacity: pulse },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  anchor: { height: 0, overflow: "visible", alignItems: "center", zIndex: 5 },
  pill: {
    position: "absolute", top: 10, flexDirection: "row", alignItems: "center", gap: 7,
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1,
  },
  warn: { backgroundColor: "rgba(23,22,42,0.72)", borderColor: colors.captureAmberPillRing },
  good: { backgroundColor: "rgba(23,22,42,0.72)", borderColor: colors.captureAlignedSoft },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 12.5, fontWeight: "600", letterSpacing: 0.3 },
  glow: { borderWidth: 4, borderRadius: 0 },
});
