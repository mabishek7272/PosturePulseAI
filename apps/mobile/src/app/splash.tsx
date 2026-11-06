import { BlurView } from "expo-blur";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useEffect } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, G, Path } from "react-native-svg";
import { VisionCamera } from "react-native-vision-camera";
import { getClinicianToken } from "../auth/tokenStore";
import { DARK_BLOBS, DriftingBlobs } from "../components/DriftingBlobs";
import { EASE_OUT, FadeUp } from "../components/FadeUp";
import { AnimatedEmblem } from "../components/AnimatedEmblem";
import { colors } from "../theme/colors";

/** Design shows the splash ~2.6s; the constellation finishes drawing at 2.9s. */
const SPLASH_MS = 2800;

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedSvg = Animated.createAnimatedComponent(Svg);

const LINES = [
  "M40 180 L130 250 L96 360 L196 410 L300 330 L352 420",
  "M130 250 L250 210 L300 330",
  "M96 360 L60 500 L170 560 L196 410",
  "M170 560 L300 600 L352 420",
  "M60 500 L120 660 L250 690 L300 600",
];
const JOINTS: [number, number, number][] = [
  [130, 250, 0.6], [196, 410, 1], [300, 330, 1.4], [170, 560, 1.8], [120, 660, 2.2], [60, 500, 2.6],
];

function Line({ d }: { d: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(300, withTiming(1, { duration: 2600, easing: EASE_OUT }));
  }, [t]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: 340 * (1 - t.value) }));
  return (
    <AnimatedPath
      d={d} stroke={colors.accent400} strokeWidth={0.7} fill="none" strokeDasharray={[340]} animatedProps={props}
    />
  );
}

function Joint({ cx, cy, delay }: { cx: number; cy: number; delay: number }) {
  const t = useSharedValue(-1);
  useEffect(() => {
    t.value = withDelay(
      delay * 1000,
      withSequence(
        withTiming(0, { duration: 0 }),
        withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }), -1, true),
      ),
    );
  }, [t, delay]);
  // ppJoint: r 3.2 -> 4.6, opacity .45 -> 1. Before the delay the joint rests at r=3, opacity 1.
  const props = useAnimatedProps(() => ({
    r: t.value < 0 ? 3 : 3.2 + 1.4 * t.value,
    opacity: t.value < 0 ? 1 : 0.45 + 0.55 * t.value,
  }));
  return <AnimatedCircle cx={cx} cy={cy} fill={colors.accent300} animatedProps={props} />;
}

/** ppRing: expands 0.8 -> 1.65 and fades over the first 70% of 3.2s, then rests. */
function Ring({ color, delay }: { color: string; delay: number }) {
  // Rests at 1 (fully faded) until its delay, so the second ring never flashes at rest.
  const t = useSharedValue(1);
  useEffect(() => {
    t.value = withDelay(
      delay,
      withRepeat(withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: 3200, easing: Easing.linear })), -1),
    );
  }, [t, delay]);
  const style = useAnimatedStyle(() => {
    const u = Math.min(t.value / 0.7, 1);
    const e = 1 - (1 - u) * (1 - u); // ease-out
    return { opacity: 0.5 * (1 - e), transform: [{ scale: 0.8 + 0.85 * e }] };
  });
  return <Animated.View pointerEvents="none" style={[styles.ring, { borderColor: color }, style]} />;
}

function Dot({ delay }: { delay: number }) {
  const t = useSharedValue(1);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) })), -1));
  }, [t, delay]);
  const style = useAnimatedStyle(() => {
    const v = t.value;
    // ppDot keyframes: .22 @0, 1 @38%, .22 @75%, .22 @100%
    const o = v < 0.38 ? 0.22 + 0.78 * (v / 0.38) : v < 0.75 ? 1 - 0.78 * ((v - 0.38) / 0.37) : 0.22;
    return { opacity: o };
  });
  return <Animated.View style={[styles.dot, style]} />;
}

export default function SplashScreen() {
  // Same destination rule the app always used: stored token -> /home, else /login.
  useEffect(() => {
    let cancelled = false;
    const minWait = new Promise<void>((resolve) => setTimeout(resolve, SPLASH_MS));
    void (async () => {
      let token: string | null = null;
      try {
        token = await getClinicianToken();
      } catch {
        token = null;
      }
      await minWait;
      // The sign-in token survives an app reinstall (Keychain) but the camera
      // permission does not, so a signed-in clinician without camera access
      // goes through the permissions screen instead of landing on a dead camera.
      let cameraAllowed = true;
      try {
        cameraAllowed = VisionCamera.cameraPermissionStatus === "authorized";
      } catch {
        cameraAllowed = true;
      }
      if (!cancelled) router.replace(!token ? "/login" : cameraAllowed ? "/home" : "/permissions");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.root}>
      <DriftingBlobs blobs={DARK_BLOBS} />
      <AnimatedSvg viewBox="0 0 390 844" style={[StyleSheet.absoluteFill, { opacity: 0.5 }]} pointerEvents="none">
        <G>
          {LINES.map((d) => <Line key={d} d={d} />)}
        </G>
        <G>
          {JOINTS.map(([cx, cy, delay]) => <Joint key={`${cx}-${cy}`} cx={cx} cy={cy} delay={delay} />)}
        </G>
      </AnimatedSvg>

      <View style={styles.center} pointerEvents="none">
        <View style={styles.logoWrap}>
          <Ring color={colors.splashRingA} delay={0} />
          <Ring color={colors.splashRingB} delay={1600} />
          <View style={styles.disc}>
            <View style={styles.discClip}>
              {Platform.OS === "ios" ? <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} /> : null}
              <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.splashDisc }]} />
              <View style={[StyleSheet.absoluteFill, styles.discRing]} />
            </View>
          </View>
          <AnimatedEmblem width={84} delay={150} />
        </View>

        <FadeUp delay={900} duration={900} style={styles.titleBlock}>
          <Text style={styles.title}>
            PosturePulse <Text style={{ color: colors.accent400 }}>Pro</Text>
          </Text>
          <Text style={styles.tagline}>SPATIAL POSTUROLOGY</Text>
        </FadeUp>

        <FadeUp delay={1500} duration={1000} distance={0} easing={EASE_OUT} style={styles.dots}>
          <Dot delay={0} />
          <Dot delay={200} />
          <Dot delay={400} />
        </FadeUp>
      </View>

      <Text style={styles.footer}>{`Clinician-supervised · v${Constants.expoConfig?.version ?? "dev"}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDark, overflow: "hidden" },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 28 },
  logoWrap: { width: 132, height: 132, alignItems: "center", justifyContent: "center" },
  ring: { ...StyleSheet.absoluteFill, borderRadius: 66, borderWidth: 1 },
  disc: {
    position: "absolute", top: 14, left: 14, right: 14, bottom: 14, borderRadius: 59,
    shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 18 },
    backgroundColor: "rgba(23,22,42,0.01)",
  },
  discClip: { flex: 1, borderRadius: 59, overflow: "hidden" },
  discRing: { borderRadius: 59, borderWidth: 1, borderColor: colors.splashDiscRing },
  titleBlock: { alignItems: "center", gap: 10 },
  title: { fontSize: 31, fontWeight: "600", letterSpacing: -1.085, color: colors.bgTint },
  tagline: { fontSize: 13, letterSpacing: 2.86, color: colors.darkAccentA },
  dots: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.accent400 },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 46, textAlign: "center",
    fontSize: 11, letterSpacing: 0.88, color: colors.darkAccentB,
  },
});
