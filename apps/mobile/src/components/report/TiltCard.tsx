import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Line, Path, Text as SvgText } from "react-native-svg";
import { tiltNumbers, type ViewReport } from "../../lib/reportSequence";
import { colors } from "../../theme/colors";
import { useTween } from "./hooks";
import { cardText, ReportCard } from "./ReportCard";

const CX = 110;
const CY = 70;
const L = 84;

function Diagram({ deg, labels }: { deg: number; labels: { theta: string; sin: string; cos: string } }) {
  const th = (deg * Math.PI) / 180;
  const ex = CX + L * Math.sin(th);
  const ey = CY + L * Math.cos(th);
  const ar = 34;
  const arc = `M ${CX} ${CY + ar} A ${ar} ${ar} 0 0 ${deg >= 0 ? 0 : 1} ${CX + ar * Math.sin(th)} ${CY + ar * Math.cos(th)}`;
  return (
    <Svg width="100%" height={170} viewBox="0 0 220 170">
      <Line x1={10} y1={CY} x2={210} y2={CY} stroke={colors.analysisRingDisc} strokeWidth={1.5} strokeDasharray="4 4" />
      <Line x1={CX} y1={CY} x2={CX} y2={CY + L} stroke={colors.analysisRingDisc} strokeWidth={1.5} strokeDasharray="4 4" />
      {/* components of the unit vector: cos along image-down, sin across */}
      <Line x1={CX} y1={ey} x2={ex} y2={ey} stroke={colors.accent300} strokeWidth={2} />
      <Line x1={CX} y1={CY} x2={CX} y2={ey} stroke={colors.accent300} strokeWidth={2} />
      <Path d={arc} stroke={colors.accent200} strokeWidth={2} fill="none" />
      <Line x1={CX} y1={CY} x2={ex} y2={ey} stroke={colors.accent400} strokeWidth={3.5} strokeLinecap="round" />
      <SvgText x={CX + 8} y={CY + ar + 16} fontSize={12} fill={colors.accent100}>{labels.theta}</SvgText>
      <SvgText x={(CX + ex) / 2} y={ey + 15} fontSize={11} fill={colors.accent200} textAnchor="middle">{`sin θ = ${labels.sin}`}</SvgText>
      <SvgText x={CX - 6} y={(CY + ey) / 2} fontSize={11} fill={colors.accent200} textAnchor="end">{`cos θ = ${labels.cos}`}</SvgText>
      <SvgText x={14} y={CY - 6} fontSize={10} fill={colors.darkAccentA}>image horizontal</SvgText>
    </Svg>
  );
}

export function TiltCard({ views, still, paused }: { views: ViewReport[]; still: boolean; paused: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (paused || still || views.length < 2) return;
    const id = setInterval(() => setI((x) => x + 1), 3200);
    return () => clearInterval(id);
  }, [paused, still, views.length]);
  const view = views[i % views.length];
  const t = tiltNumbers(view.meanRollDegrees);
  const deg = useTween(t?.degrees ?? 0, 900, still, view.stepId);
  if (!t) return null;
  return (
    <ReportCard title={`TILT CORRECTION · ${view.label}`}>
      <Diagram deg={deg} labels={{ theta: `θ = ${t.thetaLabel}`, sin: t.sinLabel, cos: t.cosLabel }} />
      <View style={styles.formula}>
        <Text style={styles.formulaText}>{"θ = atan2(gₓ, gᵧ)"}</Text>
        <Text style={cardText.caption}>{`gₓ = sin θ = ${t.sinLabel}, gᵧ = cos θ = ${t.cosLabel} (unit gravity, camera frame)`}</Text>
      </View>
      <Text style={cardText.caption}>{`θ is the mean phone roll recorded while filming this view. The server uses this angle to level every frame before measuring.`}</Text>
    </ReportCard>
  );
}

const styles = StyleSheet.create({
  formula: { gap: 3 },
  formulaText: { fontSize: 16, fontWeight: "600", color: colors.analysisTitle },
});
