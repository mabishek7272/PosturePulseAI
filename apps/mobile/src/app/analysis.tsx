import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { countMetricResults } from "../api/events";
import { UnauthorizedError } from "../api/http";
import { getClinicianToken } from "../auth/tokenStore";
import { AnalysisStages, STAGES } from "../components/AnalysisStages";
import { POSES } from "../capture/poses";
import { DriftingBlobs, type BlobSpec } from "../components/DriftingBlobs";
import { GlassCard } from "../components/GlassCard";
import { PulseDot, RingPulse, Spin } from "../components/Motion";
import { ReportSequence } from "../components/report/ReportSequence";
import { formatElapsed } from "../lib/elapsed";
import { colors } from "../theme/colors";

const BLOBS: BlobSpec[] = [
  { size: 460, left: -120, top: 60, color: colors.accent800, duration: 13 },
  { size: 380, right: -120, bottom: 40, color: colors.accent700, duration: 16, variant: 2 },
];

const POLL_MS = 2000;
const GIVE_UP_MS = 120000;

export default function AnalysisScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const insets = useSafeAreaInsets();

  // Real wall-clock time since analysis started; stops when we give up.
  useEffect(() => {
    if (error) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - t0), 1000);
    return () => clearInterval(id);
  }, [error]);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    // Stages 0-2 are local progress indication while the server works; stage
    // advances past 2 only when real metric results start arriving.
    const ticker = setInterval(() => {
      setStage((current) => (current < 2 ? current + 1 : current));
    }, 1800);

    function giveUp(message: string) {
      clearInterval(ticker);
      setError(message);
    }

    async function poll() {
      try {
        const token = await getClinicianToken();
        if (cancelled) return;
        if (!token) {
          clearInterval(ticker);
          return router.replace("/login");
        }
        const count = await countMetricResults(sessionId, token);
        if (cancelled) return;
        if (count > 0) {
          setStage(STAGES.length);
          clearInterval(ticker);
          return router.replace({ pathname: "/results", params: { sessionId } });
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          clearInterval(ticker);
          return router.replace("/login");
        }
        // Any other failure (e.g. a dropped connection) is treated as transient:
        // keep polling until the give-up deadline rather than stopping for good.
      }
      if (Date.now() - startedAt > GIVE_UP_MS) {
        return giveUp("Analysis is taking longer than expected. The clips were uploaded — check the dashboard.");
      }
      pollTimer = setTimeout(poll, POLL_MS);
    }
    poll();

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
      clearInterval(ticker);
    };
  }, [sessionId]);

  return (
    <View style={styles.root}>
      <DriftingBlobs blobs={BLOBS} />
      <View style={[styles.content, { paddingTop: Math.max(58, insets.top + 8), paddingBottom: Math.max(34, insets.bottom + 12) }]}>
        <GlassCard tint="dark" elevated={false} radius={10} intensity={16} fill={colors.analysisGlassStrong} ring={colors.captureRingSoft} style={styles.pill}>
          <View style={styles.pillInner}>
            <PulseDot style={styles.pillDot} />
            <Text style={styles.pillText}>{`Assessment · ${POSES.length} views`}</Text>
          </View>
        </GlassCard>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.disc}>
            <RingPulse duration={3400} style={[styles.halo, { borderColor: colors.analysisHaloA }]} />
            <RingPulse duration={3400} delay={1700} style={[styles.halo, { borderColor: colors.analysisHaloB }]} />
            <Svg width={176} height={176} viewBox="0 0 176 176" style={StyleSheet.absoluteFill}>
              <Circle cx={88} cy={88} r={70} fill="none" stroke={colors.analysisTrack} strokeWidth={6} />
            </Svg>
            <Spin duration={1800} style={StyleSheet.absoluteFill}>
              <Svg width={176} height={176} viewBox="0 0 176 176">
                <Circle cx={88} cy={88} r={70} fill="none" stroke={colors.accent400} strokeWidth={6} strokeLinecap="round" strokeDasharray="110 330" />
              </Svg>
            </Spin>
            <GlassCard tint="dark" elevated={false} radius={75} intensity={18} fill={colors.analysisGlass} ring={colors.analysisRingDisc} style={styles.inner} />
            <View style={styles.center}>
              <Text style={styles.big}>{formatElapsed(elapsedMs)}</Text>
              <Text style={styles.small}>ELAPSED</Text>
            </View>
          </View>

          <View style={styles.titleBlock}>
            <Text style={styles.title}>Reconstructing posture</Text>
            <Text style={styles.sub}>Your clips were uploaded to the clinic server and are being measured there.</Text>
          </View>

          <View style={styles.report}>
            <ReportSequence sessionId={sessionId} />
          </View>

          <View style={styles.stages}>
            <AnalysisStages activeStage={stage} />
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>

        <Pressable accessibilityRole="button" accessibilityLabel="Back to home" onPress={() => router.replace("/home")} style={({ pressed }) => pressed && { opacity: 0.8 }}>
          <GlassCard tint="dark" elevated={false} radius={14} intensity={18} fill={colors.analysisGlassButton} ring={colors.analysisRingButton}>
            <View style={styles.button}>
              <Text style={styles.buttonText}>Back to home</Text>
            </View>
          </GlassCard>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDark },
  content: { flex: 1, paddingHorizontal: 24 },
  pill: { alignSelf: "flex-start" },
  pillInner: { height: 32, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  pillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent400 },
  pillText: { fontSize: 11.5, fontWeight: "600", letterSpacing: 0.58, color: colors.accent100 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 16 },
  disc: { marginTop: 38, alignSelf: "center", width: 176, height: 176, alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, borderRadius: 88, borderWidth: 1 },
  inner: { position: "absolute", left: 26, top: 26, right: 26, bottom: 26 },
  center: { alignItems: "center", gap: 3 },
  big: { fontSize: 36, fontWeight: "600", letterSpacing: -1.44, color: colors.accent100, fontVariant: ["tabular-nums"] },
  small: { fontSize: 10.5, fontWeight: "600", letterSpacing: 1.68, color: colors.darkAccentA },
  titleBlock: { marginTop: 34, alignItems: "center", gap: 7 },
  title: { fontSize: 23, fontWeight: "600", letterSpacing: -0.69, color: colors.analysisTitle },
  sub: { maxWidth: 270, textAlign: "center", fontSize: 13.5, lineHeight: 20.25, color: colors.darkAccentA },
  report: { marginTop: 26 },
  stages: { marginTop: 26 },
  button: { height: 52, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 14.5, fontWeight: "600", color: colors.accent100 },
  error: { color: colors.caution, marginTop: 20, lineHeight: 20, textAlign: "center" },
});
