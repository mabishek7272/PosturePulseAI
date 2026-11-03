import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { overallCaption, sqiText, type ReportSummary, type ViewReport } from "../../lib/reportSequence";
import { colors } from "../../theme/colors";
import { useTween } from "./hooks";
import { cardText, ReportCard } from "./ReportCard";

const R = 26;
const C = 2 * Math.PI * R;

function Gauge({ view, still }: { view: ViewReport; still: boolean }) {
  const shown = useTween(view.sqi ?? 0, 1100, still);
  const frac = view.sqi === null ? 0 : shown / 100;
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${view.label}: capture quality ${view.sqi === null ? "unavailable" : `${view.sqi}, ${view.band}`}`}>
      <View style={styles.gauge}>
        <Svg width={64} height={64} viewBox="0 0 64 64" style={StyleSheet.absoluteFill}>
          <Circle cx={32} cy={32} r={R} fill="none" stroke={colors.analysisTrackSmall} strokeWidth={5} />
          {view.sqi !== null && (
            <Circle cx={32} cy={32} r={R} fill="none" stroke={colors.accent400} strokeWidth={5} strokeLinecap="round" strokeDasharray={`${C * frac} ${C}`} rotation={-90} origin="32, 32" />
          )}
        </Svg>
        <Text style={view.sqi === null ? styles.na : styles.num}>{view.sqi === null ? "n/a" : String(Math.round(shown))}</Text>
      </View>
      <Text style={styles.label}>{view.label}</Text>
      <Text style={styles.band}>{view.sqi === null ? "Unavailable" : view.band}</Text>
      <Text style={styles.stars}>{view.stars ? "★".repeat(view.stars) + "☆".repeat(3 - view.stars) : "–"}</Text>
    </View>
  );
}

export function SqiCard({ report, still }: { report: ReportSummary; still: boolean }) {
  const overall = useTween(report.overallSqi ?? 0, 1100, still);
  return (
    <ReportCard title="CAPTURE QUALITY">
      <View style={styles.grid}>
        {report.views.map((v) => (
          <Gauge key={v.stepId} view={v} still={still} />
        ))}
      </View>
      <View style={styles.overall}>
        <Text style={styles.overallNum}>{report.overallSqi === null ? sqiText(null) : String(Math.round(overall))}</Text>
        <Text style={cardText.caption}>{`Overall · ${overallCaption(report)}`}</Text>
      </View>
      <Text style={cardText.caption}>Capture quality measures how steady, centred and visible you were — it is not a clinical score.</Text>
    </ReportCard>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", justifyContent: "space-between" },
  tile: { alignItems: "center", gap: 3, flex: 1 },
  gauge: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  num: { fontSize: 18, fontWeight: "600", color: colors.accent100, fontVariant: ["tabular-nums"] },
  na: { fontSize: 11, fontWeight: "600", color: colors.darkAccentA },
  label: { fontSize: 10.5, fontWeight: "700", letterSpacing: 1.2, color: colors.accent300 },
  band: { fontSize: 11.5, color: colors.accent200 },
  stars: { fontSize: 13, color: colors.accent400 },
  overall: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  overallNum: { fontSize: 26, fontWeight: "600", color: colors.analysisTitle, fontVariant: ["tabular-nums"] },
});
