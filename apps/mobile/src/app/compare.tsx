import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { listMetricResults, type MetricResult } from "../api/events";
import { UnauthorizedError } from "../api/http";
import { earlierSessions, findPatientHistory } from "../api/patientHistory";
import type { PatientSession } from "../api/patients";
import { listSessions } from "../api/sessions-list";
import { getClinicianToken } from "../auth/tokenStore";
import { BottomTabBar } from "../components/BottomTabBar";
import { GlassCard } from "../components/GlassCard";
import { MAX_CONTENT_WIDTH } from "../components/Screen";
import { BackButton } from "../components/ScreenHeader";
import {
  COMPARE_CAPTION, compareScans, formatCompareUnsigned, formatCompareValue, formatUncertainty, withinStatement,
  type ComparedMetric,
} from "../lib/compare";
import { dateChip } from "../lib/historyData";
import { colors } from "../theme/colors";
import { type } from "../theme/typography";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

function CompareCard({ c }: { c: ComparedMetric }) {
  return (
    <GlassCard radius={15} fill={colors.glassStrong} intensity={30}>
      <View style={styles.cardPad}>
        <Text style={styles.cardTitle}>{c.label}</Text>
        <View style={styles.row}>
          <Stat label="EARLIER" value={formatCompareValue(c.a, c.unit)} sub={formatUncertainty(c.uA)} />
          <Stat label="LATER" value={formatCompareValue(c.b, c.unit)} sub={formatUncertainty(c.uB)} />
        </View>
        <View style={styles.row}>
          <Stat label="MEAN" value={formatCompareValue(c.mean, c.unit)} />
          <Stat label="DEVIATION" value={formatCompareUnsigned(c.deviation, c.unit)} />
          <Stat label="DIFFERENCE" value={formatCompareValue(c.difference, c.unit)} sub="later − earlier" />
        </View>
        <Text style={styles.statement}>{withinStatement(c)}</Text>
      </View>
    </GlassCard>
  );
}

export default function CompareScreen() {
  const params = useLocalSearchParams<{ a?: string; b: string }>();
  const bId = params.b;
  const [aId, setAId] = useState<string | undefined>(params.a || undefined);
  const [resultsA, setResultsA] = useState<MetricResult[] | null>(null);
  const [resultsB, setResultsB] = useState<MetricResult[] | null>(null);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [others, setOthers] = useState<PatientSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const now = useMemo(() => new Date(), []);

  // Same-patient sessions for the picker + dates. Non-fatal if it fails.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getClinicianToken();
        if (!token) return router.replace("/login");
        const [history, summaries] = await Promise.all([
          findPatientHistory(bId, token).catch(() => null),
          listSessions(token, 500).catch(() => []),
        ]);
        if (cancelled) return;
        setDates(Object.fromEntries(summaries.map((s) => [s.id, s.createdAt])));
        if (history) setOthers(earlierSessions(history.sessions, bId));
      } catch (err) {
        if (!cancelled && err instanceof UnauthorizedError) router.replace("/login");
      }
    })();
    return () => { cancelled = true; };
  }, [bId]);

  useEffect(() => {
    if (!aId) return;
    let cancelled = false;
    setResultsA(null);
    setResultsB(null);
    setError(null);
    (async () => {
      try {
        const token = await getClinicianToken();
        if (!token) return router.replace("/login");
        const [ra, rb] = await Promise.all([listMetricResults(aId, token), listMetricResults(bId, token)]);
        if (!cancelled) { setResultsA(ra); setResultsB(rb); }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) return router.replace("/login");
        setError(err instanceof Error ? err.message : "Could not load the scans.");
      }
    })();
    return () => { cancelled = true; };
  }, [aId, bId]);

  const comparison = useMemo(() => (resultsA && resultsB ? compareScans(resultsA, resultsB) : null), [resultsA, resultsB]);
  const chip = aId && dates[aId] && dates[bId] ? `${dateChip(dates[aId], now)} → ${dateChip(dates[bId], now)}` : null;
  const pickable = others.filter((s) => s.id !== aId);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <BackButton />
        <Text accessibilityRole="header" style={type.headerTitle}>Compare scans</Text>
        {chip ? <Text style={styles.chip}>{chip}</Text> : null}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!aId ? (
          <Text style={styles.empty}>No earlier scan for this patient yet</Text>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : !comparison ? (
          <ActivityIndicator color={colors.accent600} style={styles.loading} />
        ) : (
          <>
            <Text style={styles.caption}>{COMPARE_CAPTION}</Text>
            {comparison.compared.length === 0 ? (
              <Text style={styles.empty}>No metric has an estimate in both scans.</Text>
            ) : null}
            {comparison.compared.map((c) => <CompareCard key={c.key} c={c} />)}

            {comparison.notCompared.length > 0 ? (
              <>
                <Text style={styles.groupTitle}>Not compared</Text>
                {comparison.notCompared.map((n) => (
                  <GlassCard key={n.key} radius={15} fill={colors.glassStrong} intensity={30}>
                    <View style={styles.cardPad}>
                      <Text style={styles.cardTitle}>{n.label}</Text>
                      {n.reasons.map((r) => <Text key={r} style={styles.reason}>{r}</Text>)}
                    </View>
                  </GlassCard>
                ))}
              </>
            ) : null}
          </>
        )}

        {pickable.length > 0 ? (
          <View style={styles.pickerWrap}>
            <Pressable accessibilityRole="button" onPress={() => setPicking((p) => !p)} style={styles.pickBtn}>
              <Text style={styles.pickBtnText}>{picking ? "Hide earlier scans" : "Compare with a different earlier scan"}</Text>
            </Pressable>
            {picking
              ? pickable.map((s) => (
                  <Pressable
                    key={s.id}
                    accessibilityRole="button"
                    onPress={() => { setAId(s.id); setPicking(false); }}
                    style={styles.pickRow}
                  >
                    <Text style={styles.pickRowText}>{dateChip(s.createdAt, now)}</Text>
                  </Pressable>
                ))
              : null}
          </View>
        ) : null}
        <Text style={styles.footer}>Camera-based estimates. Not a substitute for clinical examination.</Text>
      </ScrollView>
      <BottomTabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingTop: 58, paddingBottom: 14, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.glassHeaderBar, borderBottomWidth: 1, borderBottomColor: colors.hairline,
  },
  chip: {
    marginLeft: "auto", fontSize: 12, fontWeight: "600", color: colors.accent700, overflow: "hidden",
    paddingVertical: 6, paddingHorizontal: 11, borderRadius: 9, backgroundColor: colors.accent100,
    borderWidth: 1, borderColor: colors.accent300,
  },
  content: { paddingTop: 18, paddingHorizontal: 22, paddingBottom: 120, gap: 11, width: "100%", maxWidth: MAX_CONTENT_WIDTH + 44, alignSelf: "center" },
  loading: { paddingVertical: 30 },
  error: { color: colors.caution, fontSize: 13 },
  empty: { color: colors.textFaint, fontSize: 13 },
  caption: { fontSize: 12, color: colors.textMuted },
  groupTitle: { marginTop: 8, fontSize: 13, fontWeight: "600", letterSpacing: -0.13, color: colors.text },
  cardPad: { paddingVertical: 14, paddingHorizontal: 15, gap: 10 },
  cardTitle: { fontSize: 13.5, fontWeight: "600", letterSpacing: -0.135, color: colors.text },
  row: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, minWidth: 0, gap: 2 },
  statLabel: { fontSize: 10.5, fontWeight: "600", letterSpacing: 1, color: colors.textFaint },
  statValue: { fontSize: 15, fontWeight: "600", letterSpacing: -0.3, color: colors.accent700 },
  statSub: { fontSize: 11, color: colors.textFaint },
  statement: { fontSize: 12.5, lineHeight: 18, color: colors.textBody },
  reason: { fontSize: 12.5, lineHeight: 18, color: colors.textBody },
  pickerWrap: { marginTop: 8, gap: 8 },
  pickBtn: {
    alignSelf: "center", height: 42, paddingHorizontal: 20, borderRadius: 14, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.accent300,
  },
  pickBtnText: { fontSize: 13, fontWeight: "600", color: colors.accent700 },
  pickRow: { paddingVertical: 12, paddingHorizontal: 15, borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline },
  pickRowText: { fontSize: 13.5, color: colors.text },
  footer: { marginTop: 6, color: colors.textFaint, fontSize: 11, textAlign: "center" },
});
