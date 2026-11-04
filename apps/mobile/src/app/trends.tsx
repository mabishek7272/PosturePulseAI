import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { listSessions, type SessionSummary } from "../api/sessions-list";
import { UnauthorizedError } from "../api/http";
import { getClinicianToken } from "../auth/tokenStore";
import { BottomTabBar } from "../components/BottomTabBar";
import { FadeUp } from "../components/FadeUp";
import { GlassCard } from "../components/GlassCard";
import { ArrowDownIcon, ArrowUpIcon, SparkleIcon } from "../components/icons";
import { RingPulse } from "../components/Motion";
import { SegmentedControl } from "../components/Pill";
import { TrendChart } from "../components/TrendChart";
import { countInWindow, deltaCaption, RANGE_OPTIONS, rangeWeeks, weeklyCounts, type Delta, type TrendRange } from "../lib/trendsData";
import { colors } from "../theme/colors";
import { shadows } from "../theme/shadows";
import { type } from "../theme/typography";

const FETCH_LIMIT = 500;
const STUB_COLORS = [colors.accent200, colors.accent200, colors.accent200, colors.accent300, colors.accent400, colors.accent600];

export default function TrendsScreen() {
  const now = useMemo(() => new Date(), []);
  const [range, setRange] = useState<TrendRange>("12w");
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getClinicianToken();
        if (!token) return router.replace("/login");
        const found = await listSessions(token, FETCH_LIMIT);
        if (!cancelled) setSessions(found);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) return router.replace("/login");
        setError(err instanceof Error ? err.message : "Could not load sessions.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const weeks = useMemo(() => (sessions ? rangeWeeks(range, sessions, now) : 12), [sessions, range, now]);
  const counts = useMemo(() => (sessions ? weeklyCounts(sessions, now, weeks) : []), [sessions, now, weeks]);
  const stats = useMemo(() => {
    if (!sessions) return null;
    const week = countInWindow(sessions, now, 0, 7);
    const lastWeek = countInWindow(sessions, now, 7, 14);
    const four = countInWindow(sessions, now, 0, 28);
    const prevFour = countInWindow(sessions, now, 28, 56);
    return {
      week,
      four,
      weekDelta: deltaCaption(week, lastWeek, "last week"),
      fourDelta: deltaCaption(four, prevFour, "the 4 weeks before"),
    };
  }, [sessions, now]);

  const inRange = counts.reduce((a, b) => a + b, 0);
  // 0 for a missing week is a count of nothing, not a fabricated measurement.
  const thisWeek = counts[counts.length - 1] ?? 0;
  const prevWeek = counts[counts.length - 2] ?? 0;
  const chartDelta = thisWeek - prevWeek;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={type.title}>Trends</Text>
        <View style={styles.segment}>
          <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={setRange} variant="inset" />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <FadeUp>
          <GlassCard fill={colors.glassCard} ring={colors.hairline} radius={20} intensity={40} style={styles.cardShadow}>
            <View style={styles.bigPad}>
              <View style={styles.chartHead}>
                <Text style={styles.cardTitle}>Assessments per week</Text>
                {sessions && inRange > 0 ? (
                  <>
                    <Text style={styles.bigNumber}>{thisWeek}</Text>
                    {chartDelta !== 0 ? (
                      <Text style={styles.bigDelta}>{chartDelta > 0 ? `+${chartDelta}` : `−${-chartDelta}`}</Text>
                    ) : null}
                  </>
                ) : null}
              </View>
              {error ? (
                <Text style={styles.error}>{error}</Text>
              ) : sessions === null ? (
                <ActivityIndicator color={colors.accent600} style={styles.loading} />
              ) : (
                <>
                  <TrendChart key={`${range}-${weeks}`} counts={counts} />
                  {inRange === 0 ? <Text style={styles.empty}>No assessments in this range yet.</Text> : null}
                </>
              )}
            </View>
          </GlassCard>
        </FadeUp>

        <FadeUp delay={80} style={styles.statRow}>
          <StatCard label="This week" value={stats?.week} delta={stats?.weekDelta} />
          <StatCard label="Last 4 weeks" value={stats?.four} delta={stats?.fourDelta} />
        </FadeUp>

        <FadeUp delay={140}>
          <GlassCard fill={colors.glassCard} ring={colors.hairline} radius={20} intensity={40} elevated={false}>
            <View style={styles.bigPad}>
              <Text style={styles.cardTitle}>Exercise adherence</Text>
              <View style={styles.bars}>
                <Text style={styles.barsEmpty}>Not available yet</Text>
                <View style={styles.stubs}>
                  {STUB_COLORS.map((c, i) => (
                    <View key={i} style={[styles.stub, { backgroundColor: c }]} />
                  ))}
                </View>
              </View>
            </View>
          </GlassCard>
        </FadeUp>

        <FadeUp delay={200}>
          <GlassCard fill={colors.glassLavender} ring={colors.accent300} radius={18} elevated={false}>
            <View style={styles.pulsePad}>
              <View style={styles.pulseHead}>
                <View style={styles.pulseIcon}>
                  <RingPulse duration={3200} style={styles.pulseRing} />
                  <SparkleIcon size={16} color={colors.accent700} />
                </View>
                <Text style={styles.pulseEyebrow}>PULSE AI · PATTERN</Text>
              </View>
              <Text style={styles.pulseBody}>Not available yet.</Text>
            </View>
          </GlassCard>
        </FadeUp>
      </ScrollView>
      <BottomTabBar />
    </View>
  );
}

function StatCard({ label, value, delta }: { label: string; value?: number; delta?: Delta }) {
  return (
    <GlassCard fill={colors.glassStat} ring={colors.hairline} radius={18} intensity={36} elevated={false} style={styles.flex}>
      <View style={styles.statPad}>
        <Text style={styles.statLabel}>{label}</Text>
        <Text style={styles.statValue}>{value ?? "—"}</Text>
        {delta ? (
          <View style={styles.deltaRow}>
            {delta.direction === "up" ? <ArrowUpIcon size={12} color={colors.accent700} strokeWidth={2.6} /> : null}
            {delta.direction === "down" ? <ArrowDownIcon size={12} color={colors.accent600} strokeWidth={2.6} /> : null}
            <Text style={[styles.deltaText, { color: delta.direction === "down" ? colors.accent600 : colors.accent700 }]}>{delta.text}</Text>
          </View>
        ) : null}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    paddingTop: 58, paddingBottom: 14, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.glassHeaderBar,
  },
  segment: { marginLeft: "auto" },
  content: { paddingTop: 10, paddingHorizontal: 22, paddingBottom: 110, gap: 14 },
  cardShadow: shadows.cardLg,
  bigPad: { paddingVertical: 18, paddingHorizontal: 16 },
  cardTitle: { fontSize: 13, fontWeight: "600", letterSpacing: -0.13, color: colors.text },
  chartHead: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  bigNumber: { marginLeft: "auto", fontSize: 24, fontWeight: "600", letterSpacing: -0.84, color: colors.text },
  bigDelta: { fontSize: 12.5, fontWeight: "600", color: colors.accent700 },
  loading: { height: 140, justifyContent: "center" },
  error: { marginTop: 14, color: colors.caution },
  empty: { marginTop: 6, textAlign: "center", fontSize: 12.5, color: colors.textFaint },

  statRow: { flexDirection: "row", gap: 11 },
  statPad: { padding: 15 },
  statLabel: { fontSize: 11.5, letterSpacing: 0.23, color: colors.textMuted },
  statValue: { marginTop: 6, fontSize: 22, fontWeight: "600", letterSpacing: -0.77, color: colors.text },
  deltaRow: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 5 },
  deltaText: { flexShrink: 1, fontSize: 11.5, fontWeight: "600" },

  bars: { marginTop: 16, height: 76, justifyContent: "flex-end" },
  barsEmpty: { position: "absolute", top: 14, left: 0, right: 0, textAlign: "center", fontSize: 13, color: colors.textFaint },
  stubs: { flexDirection: "row", alignItems: "flex-end", gap: 7 },
  stub: { flex: 1, height: 4, borderTopLeftRadius: 4, borderTopRightRadius: 4, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },

  pulsePad: { paddingVertical: 17, paddingHorizontal: 16 },
  pulseHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  pulseIcon: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  pulseRing: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 14,
    borderWidth: 1, borderColor: colors.accentRing,
  },
  pulseEyebrow: { fontSize: 11, fontWeight: "600", letterSpacing: 1.43, color: colors.accent700 },
  pulseBody: { marginTop: 11, fontSize: 13.5, lineHeight: 20.9, color: colors.textBody },
});
