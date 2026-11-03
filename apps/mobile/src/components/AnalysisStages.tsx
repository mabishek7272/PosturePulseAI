import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors } from "../theme/colors";
import { GlassCard } from "./GlassCard";
import { CheckIcon } from "./icons";
import { Spin, TypeDot } from "./Motion";

/**
 * Six stages, each literally true of the server pipeline: upload, frame
 * extraction, landmark location, angle computation, quality gating, reference
 * comparison. Describing computation makes no clinical claim, and the copy
 * deliberately avoids the banned clinical-claim vocabulary (scripts/lint-claims.sh).
 */
export const STAGES = [
  "Uploading clips",
  "Extracting frames",
  "Locating body landmarks",
  "Computing joint angles",
  "Checking measurement quality",
  "Comparing with references",
];

type StageState = "pending" | "active" | "done";

export function AnalysisStages({ activeStage }: { activeStage: number }) {
  return (
    <View style={styles.list}>
      {STAGES.map((label, index) => (
        <Stage key={label} label={label} state={index < activeStage ? "done" : index === activeStage ? "active" : "pending"} />
      ))}
    </View>
  );
}

function Stage({ label, state }: { label: string; state: StageState }) {
  if (state === "pending") {
    return (
      <View style={[styles.row, styles.pendingRow]} accessibilityLabel={`${label}, waiting`}>
        <View style={styles.emptyCircle} />
        <Text style={[styles.label, styles.pendingLabel]}>{label}</Text>
      </View>
    );
  }
  const active = state === "active";
  return (
    <GlassCard
      tint="dark"
      elevated={false}
      radius={15}
      intensity={18}
      fill={active ? colors.analysisActiveFill : colors.analysisGlass}
      ring={active ? colors.analysisActiveRing : colors.analysisRing}
      style={styles.card}
    >
      <View style={styles.row} accessibilityLabel={`${label}, ${active ? "in progress" : "done"}`}>
        {active ? (
          <Spin duration={1100} style={styles.icon}>
            <Svg width={24} height={24} viewBox="0 0 24 24">
              <Circle cx={12} cy={12} r={9.5} fill="none" stroke={colors.analysisTrackSmall} strokeWidth={2.4} />
              <Circle cx={12} cy={12} r={9.5} fill="none" stroke={colors.accent300} strokeWidth={2.4} strokeLinecap="round" strokeDasharray="20 40" />
            </Svg>
          </Spin>
        ) : (
          <View style={[styles.icon, styles.doneCircle]}>
            <CheckIcon size={13} color={colors.white} strokeWidth={3} />
          </View>
        )}
        <Text style={[styles.label, active ? styles.activeLabel : styles.doneLabel]}>{label}</Text>
        {active ? (
          <View style={styles.dots}>
            <TypeDot style={styles.dot} />
            <TypeDot delay={150} style={styles.dot} />
            <TypeDot delay={300} style={styles.dot} />
          </View>
        ) : null}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  list: { alignSelf: "stretch", gap: 10 },
  card: { alignSelf: "stretch" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 15 },
  pendingRow: {
    borderRadius: 15,
    backgroundColor: colors.analysisGlassDim,
    borderWidth: 1,
    borderColor: colors.analysisRingDim,
  },
  icon: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  doneCircle: { borderRadius: 12, backgroundColor: colors.accent600 },
  emptyCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.analysisRingEmpty },
  label: { flex: 1, fontSize: 14 },
  doneLabel: { fontWeight: "500", color: colors.accent200 },
  activeLabel: { fontWeight: "600", color: colors.accent100 },
  pendingLabel: { fontWeight: "500", color: colors.darkAccentB },
  dots: { flexDirection: "row", gap: 3, marginLeft: "auto" },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accent300 },
});
