import { StyleSheet, Text } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import { illustrationAngle } from "../../lib/reportSequence";
import { colors } from "../../theme/colors";
import { useTween } from "./hooks";
import { cardText, ReportCard } from "./ReportCard";

const A = { x: 40, y: 120 };
const B = { x: 180, y: 120 - 140 * (5 / 12) };

export function AngleCard({ still }: { still: boolean }) {
  const ill = illustrationAngle();
  const p = useTween(1, 1300, still);
  const ex = A.x + (B.x - A.x) * p;
  const ey = A.y + (B.y - A.y) * p;
  const r = 50;
  const rad = (ill.degrees * Math.PI) / 180 * p;
  const arc = `M ${A.x + r} ${A.y} A ${r} ${r} 0 0 0 ${A.x + r * Math.cos(rad)} ${A.y - r * Math.sin(rad)}`;
  return (
    <ReportCard title="ANGLE FROM TWO POINTS" tag="Illustration — not this patient's result">
      <Svg width="100%" height={150} viewBox="0 0 220 150" accessibilityLabel="Illustration of an angle computed from two points">
        <Line x1={A.x} y1={A.y} x2={200} y2={A.y} stroke={colors.analysisRingDisc} strokeWidth={1.5} strokeDasharray="4 4" />
        <Line x1={A.x} y1={A.y} x2={ex} y2={ey} stroke={colors.accent400} strokeWidth={3} strokeLinecap="round" />
        <Path d={arc} stroke={colors.accent200} strokeWidth={2} fill="none" />
        <Circle cx={A.x} cy={A.y} r={5} fill={colors.accent200} />
        <Circle cx={ex} cy={ey} r={5} fill={colors.accent200} opacity={p} />
        <SvgText x={A.x - 4} y={A.y + 18} fontSize={11} fill={colors.accent200}>P1</SvgText>
        <SvgText x={B.x + 4} y={B.y - 6} fontSize={11} fill={colors.accent200} opacity={p}>P2</SvgText>
        <SvgText x={A.x + r + 8} y={A.y - 6} fontSize={12} fill={colors.accent100} opacity={p}>{"θ"}</SvgText>
      </Svg>
      <Text style={styles.formula}>{`θ = atan2(Δy, Δx) = atan2(${ill.dy}, ${ill.dx}) = ${ill.label}`}</Text>
      <Text style={cardText.caption}>Generic example numbers. The server computes each joint angle this way from landmark coordinates, using the leveled frames, then combines frames with a median.</Text>
    </ReportCard>
  );
}

const styles = StyleSheet.create({ formula: { fontSize: 14, fontWeight: "600", color: colors.analysisTitle } });
