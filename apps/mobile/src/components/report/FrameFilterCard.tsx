import { StyleSheet, Text, View } from "react-native";
import { keptFraction, type ReportSummary } from "../../lib/reportSequence";
import { colors, reportColors } from "../../theme/colors";
import { useTween } from "./hooks";
import { cardText, ReportCard } from "./ReportCard";

export function FrameFilterCard({ report, still }: { report: ReportSummary; still: boolean }) {
  const frac = keptFraction(report);
  const w = useTween(frac ?? 0, 1200, still);
  return (
    <ReportCard title="FRAME FILTERING">
      {frac === null ? (
        <Text style={cardText.strong}>No pre-check frames were recorded for this scan.</Text>
      ) : (
        <>
          <View style={styles.bar} accessible accessibilityLabel={`${report.framesKept} of ${report.framesAnalysed} frames kept, ${report.framesFiltered} filtered out`}>
            <View style={[styles.kept, { flex: w }]} />
            <View style={[styles.filtered, { flex: Math.max(0, 1 - w) }]} />
          </View>
          <View style={styles.counts}>
            <View>
              <Text style={styles.big}>{report.framesKept}</Text>
              <Text style={cardText.caption}>frames kept</Text>
            </View>
            <View style={styles.right}>
              <Text style={styles.big}>{report.framesFiltered}</Text>
              <Text style={cardText.caption}>filtered out</Text>
            </View>
          </View>
          <Text style={cardText.caption}>{`${report.framesAnalysed} frames checked across ${report.views.filter((v) => v.framesAnalysed > 0).length} views`}</Text>
        </>
      )}
      <Text style={cardText.caption}>On-device pre-check (pose guide). The clinic server runs its own quality filter.</Text>
    </ReportCard>
  );
}

const styles = StyleSheet.create({
  bar: { height: 26, borderRadius: 13, overflow: "hidden", flexDirection: "row", backgroundColor: reportColors.filtered },
  kept: { backgroundColor: colors.accent400 },
  filtered: { backgroundColor: reportColors.filtered },
  counts: { flexDirection: "row", justifyContent: "space-between" },
  right: { alignItems: "flex-end" },
  big: { fontSize: 26, fontWeight: "600", color: colors.analysisTitle, fontVariant: ["tabular-nums"] },
});
