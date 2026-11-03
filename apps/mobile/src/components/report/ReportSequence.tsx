import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getSessionStats } from "../../capture/session-stats";
import { buildReport, nextIndex } from "../../lib/reportSequence";
import { colors } from "../../theme/colors";
import { AngleCard } from "./AngleCard";
import { FrameFilterCard } from "./FrameFilterCard";
import { useReduceMotion } from "./hooks";
import { ScanSummary } from "./ScanSummary";
import { SqiCard } from "./SqiCard";
import { TiltCard } from "./TiltCard";
import { UnavailableCard } from "./UnavailableCard";

const CARD_MS = 7000;

/** Cards that play while the real analysis runs. Pure presentation: no delay is added to the real flow. */
export function ReportSequence({ sessionId }: { sessionId: string | undefined }) {
  const still = useReduceMotion();
  const report = useMemo(() => buildReport(sessionId ? getSessionStats(sessionId) : []), [sessionId]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const cards = useMemo(() => {
    const list: { key: string; node: (still: boolean, paused: boolean) => React.ReactNode }[] = [];
    if (!report.hasAny) list.push({ key: "na", node: () => <UnavailableCard /> });
    else {
      list.push({ key: "sqi", node: (s) => <SqiCard report={report} still={s} /> });
      list.push({ key: "frames", node: (s) => <FrameFilterCard report={report} still={s} /> });
      if (report.rollViews.length) list.push({ key: "tilt", node: (s, p) => <TiltCard views={report.rollViews} still={s} paused={p} /> });
    }
    list.push({ key: "angle", node: (s) => <AngleCard still={s} /> });
    return list;
  }, [report]);

  useEffect(() => {
    if (paused || still || cards.length < 2) return;
    const id = setInterval(() => setIndex((i) => nextIndex(i, cards.length)), CARD_MS);
    return () => clearInterval(id);
  }, [paused, still, cards.length]);

  const current = cards[index % cards.length];
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={paused ? "Resume report cards" : "Pause on this report card"}
        onPress={() => setPaused((p) => !p)}
      >
        {current.node(still, paused)}
      </Pressable>
      <View style={styles.dots}>
        {cards.map((c, i) => (
          <Pressable key={c.key} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Show card ${i + 1} of ${cards.length}`} onPress={() => { setIndex(i); setPaused(true); }}>
            <View style={[styles.dot, i === index % cards.length && styles.dotOn]} />
          </Pressable>
        ))}
        <Text style={styles.hint}>{paused ? "Paused · tap card to resume" : still ? "Tap a dot to change card" : "Tap card to pause"}</Text>
      </View>
      <ScanSummary report={report} />
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.analysisTrackSmall },
  dotOn: { backgroundColor: colors.accent400, width: 18 },
  hint: { marginLeft: "auto", fontSize: 11, color: colors.darkAccentB },
});
