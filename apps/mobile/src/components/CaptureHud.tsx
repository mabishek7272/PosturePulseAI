import { Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, useState } from "react";
import type { LiveStats } from "../capture/use-capture-analysis";
import type { ClipStats } from "../capture/session-stats";
import { colors } from "../theme/colors";
import { Stars } from "./CaptureChrome";

const PRECHECK_NOTE = "On-device pre-check of filming conditions. The measurement is computed on the clinic server.";

/** Compact recording strip (replaces the guidance strip): quality score + band, steadiness, streak and frame tally. */
export function RecordingHud({
  getLive, poseGuideRunning,
}: { startedAt?: number; totalSeconds?: number; getLive: () => LiveStats; poseGuideRunning: boolean }) {
  const [live, setLive] = useState<LiveStats>(() => getLive());
  useEffect(() => {
    const id = setInterval(() => setLive(getLive()), 250);
    return () => clearInterval(id);
  }, [getLive]);

  const sqi = live.sqi;
  const steady = poseGuideRunning && live.steadyNow;
  return (
    <View style={styles.hud} accessibilityLabel={sqi === null ? "Capture quality not available yet" : `Capture quality ${sqi} of 100, ${live.band}`}>
      <View style={styles.topRow}>
        <Text style={styles.value} numberOfLines={1}>
          Capture quality {!poseGuideRunning ? "unavailable" : sqi === null ? "measuring…" : `${sqi} · ${live.band}`}
        </Text>
        <View style={[styles.steady, steady && styles.steadyOk]} accessibilityLiveRegion="polite">
          <Text style={[styles.steadyText, steady && styles.steadyTextOk]}>{steady ? "Steady" : "Hold still"}</Text>
        </View>
      </View>
      <Text style={styles.stat} numberOfLines={2}>
        {poseGuideRunning
          ? `Streak ${live.streakSeconds.toFixed(0)} s · ${live.framesKept} kept · ${live.framesFiltered} filtered of ${live.framesAnalysed}`
          : "Pose guide off"}
        {" · filming conditions only"}
      </Text>
    </View>
  );
}

/** Brief per-pose card shown after a clip is uploaded. Never says anything about the clinical result. */
export function PoseResultCard({
  title, stats, last, onContinue, onRescan,
}: { title: string; stats: ClipStats; last: boolean; onContinue: () => void; onRescan?: () => void }) {
  const lowQuality = isLowQuality(stats);
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
      {lowQuality ? (
        <Text style={styles.value}>Filming conditions were poor for this view. Rescanning it is recommended.</Text>
      ) : null}
      <View style={styles.ctaRow}>
        {onRescan ? (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Records this view again; the views already saved are kept"
            onPress={onRescan}
            style={[styles.cta, lowQuality ? null : styles.ctaSecondary]}
          >
            <Text style={[styles.ctaText, lowQuality ? null : styles.ctaTextSecondary]}>Rescan this view</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={onContinue}
          style={[styles.cta, lowQuality && onRescan ? styles.ctaSecondary : null]}
        >
          <Text style={[styles.ctaText, lowQuality && onRescan ? styles.ctaTextSecondary : null]}>
            {last ? "Continue to analysis" : "Next view"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Two stars or fewer: filming conditions poor enough to suggest a rescan (display only). */
export function isLowQuality(stats: Pick<ClipStats, "stars">): boolean {
  return stats.stars !== null && stats.stars <= 2;
}

const styles = StyleSheet.create({
  hud: { paddingVertical: 8, paddingHorizontal: 12, gap: 4 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  steady: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 8, backgroundColor: colors.captureChip },
  steadyOk: { backgroundColor: "rgba(143,227,192,0.18)" },
  steadyText: { color: colors.accent300, fontSize: 11.5, fontWeight: "600" },
  steadyTextOk: { color: colors.captureAligned },
  gaugeHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { color: colors.accent400, fontSize: 11, fontWeight: "600", letterSpacing: 1.43 },
  value: { color: colors.captureBody, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.captureSegOff, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent400 },
  stats: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  stat: { color: colors.captureBody, fontSize: 11.5 },
  note: { color: colors.captureGuide, fontSize: 10, lineHeight: 13 },
  result: { padding: 14, gap: 6, alignItems: "center" },
  cta: { marginTop: 6, paddingVertical: 11, paddingHorizontal: 22, borderRadius: 14, backgroundColor: colors.accent600 },
  ctaText: { color: colors.white, fontSize: 14, fontWeight: "600" },
  ctaRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10 },
  ctaSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.accent400 },
  ctaTextSecondary: { color: colors.accent300 },
});
