import { StyleSheet, Text, View } from "react-native";
import type { ReportSummary } from "../../lib/reportSequence";
import { colors, reportColors } from "../../theme/colors";

function Badge({ text }: { text: string }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

/** Recognition of the capture only: no judgement of the person. */
export function ScanSummary({ report }: { report: ReportSummary }) {
  if (!report.hasAny) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.head}>SCAN SUMMARY</Text>
      <View style={styles.row}>
        <Badge text={`★ ${report.starsTotal} of ${report.starsMax} stars`} />
        {report.bestSteadySeconds > 0 && <Badge text={`Longest steady stretch ${report.bestSteadySeconds.toFixed(1)} s`} />}
        {report.fullSet && <Badge text="Full set · 4 views" />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 14 },
  head: { fontSize: 10.5, fontWeight: "700", letterSpacing: 1.4, color: colors.darkAccentA },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badge: { backgroundColor: reportColors.tag, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 6, borderWidth: 1, borderColor: reportColors.cardRing },
  text: { fontSize: 12, fontWeight: "600", color: colors.accent100 },
});
