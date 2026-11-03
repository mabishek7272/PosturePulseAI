import { Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, useState } from "react";
import { formatRemaining } from "../capture/sqi";
import type { LiveStats } from "../capture/use-capture-analysis";
import type { ClipStats } from "../capture/session-stats";
import { colors } from "../theme/colors";
import { useElapsedSeconds, Stars } from "./CaptureChrome";

const PRECHECK_NOTE = "On-device pre-check of filming conditions. The measurement is computed on the clinic server.";

/** Live recording card: real-time remaining readout, steadiness, capture quality, frame tally, streak. */
export function RecordingHud({
  startedAt, totalSeconds, getLive, poseGuideRunning,
}: { startedAt: number; totalSeconds: number; getLive: () => LiveStats; poseGuideRunning: boolean }) {
  const elapsed = useElapsedSeconds(startedAt);
  const [live, setLive] = useState<LiveStats>(() => getLive());
  useEffect(() => {
    const id = setInterval(() => setLive(getLive()), 250);
    return () => clearInterval(id);
  }, [getLive]);

  const sqi = live.sqi;
  return (
    <View style={styles.hud}>
      <View style={styles.topRow}>
        <Text style={styles.label}>RECORDING · {formatRemaining(elapsed, totalSeconds)} LEFT</Text>
        <View style={[styles.steady, poseGuideRunning && live.steadyNow && styles.steadyOk]} accessibilityLiveRegion="polite">
          <Text style={[styles.steadyText, poseGuideRunning && live.steadyNow && styles.steadyTextOk]}>
            {!poseGuideRunning ? "Hold still" : live.steadyNow ? "Steady" : "Hold still"}
          </Text>
        </View>
      </View>

      <View style={styles.gaugeHead}>
        <Text style={styles.label}>CAPTURE QUALITY</Text>
        <Text style={styles.value}>
          {!poseGuideRunning ? "Unavailable" : sqi === null ? "Measuring…" : `${sqi} · ${live.band}`}
        </Text>
      </View>
      <View style={styles.track} accessibilityRole="progressbar" accessibilityLabel={sqi === null ? "Capture quality not available yet" : `Capture quality ${sqi} of 100, ${live.band}`}>
        <View style={[styles.fill, { width: `${sqi ?? 0}%` }]} />
      </View>

      <View style={styles.stats}>
        <Text style={styles.stat}>Steady streak {live.streakSeconds.toFixed(0)} s</Text>
        <Text style={styles.stat}>
          {poseGuideRunning ? `${live.framesAnalysed} analysed · ${live.framesKept} kept · ${live.framesFiltered} filtered` : "Pose guide off"}
        </Text>
      </View>
      <Text style={styles.note}>{PRECHECK_NOTE}</Text>
    </View>
  );
}

/** Brief per-pose card shown after a clip is uploaded. Never says anything about the clinical result. */
export function PoseResultCard({
  title, stats, last, onContinue,
}: { title: string; stats: ClipStats; last: boolean; onContinue: () => void }) {
  return (
    <View style={styles.result}>
      <Text style={styles.label}>{title.toUpperCase()} · SAVED</Text>
      {stats.stars !== null ? (
        <>
          <Stars count={stats.stars} />
          <Text style={styles.value}>Capture quality {stats.sqi} · {stats.band}</Text>
        </>
      ) : (
        <Text style={styles.value}>Capture quality unavailable (the pose guide was not running)</Text>
      )}
      <Text style={styles.stat}>
        Longest steady streak {stats.longestSteadySeconds.toFixed(1)} s
        {stats.framesAnalysed > 0 ? ` · ${stats.framesFiltered} of ${stats.framesAnalysed} checked frames filtered out` : ""}
      </Text>
      <Text style={styles.note}>
        Stars describe filming conditions only (framing, steadiness, level). They say nothing about the result. {PRECHECK_NOTE}
      </Text>
      <Pressable accessibilityRole="button" onPress={onContinue} style={styles.cta}>
        <Text style={styles.ctaText}>{last ? "Continue to analysis" : "Next view"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hud: { paddingVertical: 14, paddingHorizontal: 16, gap: 8 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  steady: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.captureChip },
  steadyOk: { backgroundColor: "rgba(143,227,192,0.18)" },
  steadyText: { color: colors.accent300, fontSize: 13, fontWeight: "600" },
  steadyTextOk: { color: colors.captureAligned },
  gaugeHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { color: colors.accent400, fontSize: 11, fontWeight: "600", letterSpacing: 1.43 },
  value: { color: colors.captureBody, fontSize: 14, fontWeight: "600" },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.captureSegOff, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent400 },
  stats: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  stat: { color: colors.captureBody, fontSize: 12.5 },
  note: { color: colors.captureGuide, fontSize: 10.5, lineHeight: 14 },
  result: { padding: 18, gap: 8, alignItems: "center" },
  cta: { marginTop: 6, paddingVertical: 11, paddingHorizontal: 22, borderRadius: 14, backgroundColor: colors.accent600 },
  ctaText: { color: colors.white, fontSize: 14, fontWeight: "600" },
});
