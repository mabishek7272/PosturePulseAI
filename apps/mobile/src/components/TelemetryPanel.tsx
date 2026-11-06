import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { telemetryRows, type TelemetryRow } from "../capture/telemetry";
import type { Telemetry } from "../capture/use-capture-analysis";
import { colors } from "../theme/colors";
import { CaptureGlass } from "./CaptureChrome";

const TONE: Record<TelemetryRow["tone"], string> = {
  ok: colors.captureAligned,
  warn: colors.captureAmber,
  unknown: colors.captureGuide,
};

/**
 * Live sensor readout for the capture screen: tilt, body size in frame, hip
 * movement and pose-tracking confidence, each against its target. Collapsed to
 * one line by default so it does not crowd the camera view. Filming conditions
 * only - it says nothing about posture, and nothing here is uploaded.
 */
export function TelemetryPanel({ telemetry }: { telemetry: Telemetry }) {
  const [open, setOpen] = useState(false);
  const rows = telemetryRows(telemetry);
  const warnings = rows.filter((r) => r.tone === "warn").length;
  return (
    <CaptureGlass radius={12} ring={colors.captureRingSoft} style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? "Hide live sensor readings" : "Show live sensor readings"}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={styles.head}
      >
        <Text style={styles.title}>Live sensors</Text>
        <Text style={[styles.summary, { color: warnings ? TONE.warn : TONE.ok }]}>
          {warnings ? `${warnings} to adjust` : "All in range"} {open ? "▴" : "▾"}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.rows} accessibilityLiveRegion="none">
          {rows.map((r) => (
            <View key={r.key} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: TONE[r.tone] }]} />
              <Text style={styles.label} numberOfLines={1}>{r.label}</Text>
              <Text style={styles.value} numberOfLines={1}>{r.value}</Text>
              <Text style={styles.target} numberOfLines={1}>{r.target}</Text>
            </View>
          ))}
          <Text style={styles.note}>Filming conditions only. Not uploaded.</Text>
        </View>
      ) : null}
    </CaptureGlass>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, alignSelf: "stretch" },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 7, paddingHorizontal: 12 },
  title: { color: colors.accent300, fontSize: 12, fontWeight: "600", letterSpacing: 0.6 },
  summary: { fontSize: 12, fontWeight: "600" },
  rows: { paddingHorizontal: 12, paddingBottom: 9, gap: 5 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { color: colors.captureBody, fontSize: 12, flex: 1.3 },
  value: { color: colors.white, fontSize: 12.5, fontWeight: "700", flex: 1.2, fontVariant: ["tabular-nums"] },
  target: { color: colors.captureGuide, fontSize: 11, flex: 1.1, textAlign: "right" },
  note: { color: colors.captureGuide, fontSize: 10, marginTop: 2 },
});
