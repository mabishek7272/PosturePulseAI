import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { listSessions, SessionSummary } from "../api/sessions-list";
import { getClinicianToken } from "../auth/tokenStore";
import { BottomTabBar } from "../components/BottomTabBar";
import { FadeUp } from "../components/FadeUp";
import { GlassCard } from "../components/GlassCard";
import { BackButton } from "../components/ScreenHeader";
import { cardTitle, dateChip, ordinalAt, sessionCountLabel, sortNewestFirst, summaryLine } from "../lib/historyData";
import { colors, gradients } from "../theme/colors";
import { radii } from "../theme/radii";
import { shadows } from "../theme/shadows";
import { type } from "../theme/typography";

const FETCH_LIMIT = 500;

export default function HistoryScreen() {
  const now = useMemo(() => new Date(), []);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getClinicianToken();
        if (!token) return router.replace("/login");
        const found = await listSessions(token, FETCH_LIMIT);
        if (!cancelled) setSessions(sortNewestFirst(found));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load sessions.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const truncated = (sessions?.length ?? 0) >= FETCH_LIMIT;
  const total = sessions?.length ?? 0;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <BackButton />
        <Text accessibilityRole="header" style={type.headerTitle}>Session history</Text>
        {sessions && sessions.length > 0 ? (
          <Text style={styles.countChip}>{sessionCountLabel(total, truncated)}</Text>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : sessions === null ? (
          <ActivityIndicator color={colors.accent600} style={styles.loading} />
        ) : sessions.length === 0 ? (
          <Text style={styles.empty}>No sessions yet.</Text>
        ) : (
          <>
            <View style={styles.timeline}>
              <LinearGradient colors={gradients.timeline} style={styles.line} />
              <View style={styles.cards}>
                {sessions.map((s, i) => {
                  const first = i === 0;
                  const oldest = i === total - 1 && total > 1;
                  return (
                    <FadeUp key={s.id} delay={Math.min(i, 12) * 70} duration={600} style={styles.item}>
                      <View style={styles.bubbleWrap}>
                        <View style={styles.bubbleRing} />
                        {first ? (
                          <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.bubble, shadows.bubble]}>
                            <Text style={[styles.bubbleText, { color: colors.accent100 }]}>{ordinalAt(i, total)}</Text>
                          </LinearGradient>
                        ) : (
                          <View style={[styles.bubble, { backgroundColor: oldest ? colors.hairline : colors.accent200 }]}>
                            <Text style={[styles.bubbleText, { color: oldest ? colors.textSecondary : colors.accent700 }]}>{ordinalAt(i, total)}</Text>
                          </View>
                        )}
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Open the report for the scan on ${dateChip(s.createdAt, now)}`}
                        onPress={() => router.push({ pathname: "/results", params: { sessionId: s.id } })}
                        style={({ pressed }) => [styles.cardFlex, pressed && { opacity: 0.7 }]}
                      >
                        <SessionCard session={s} now={now} highlighted={first} />
                      </Pressable>
                    </FadeUp>
                  );
                })}
              </View>
            </View>
            {truncated ? <Text style={styles.note}>Showing the most recent {FETCH_LIMIT} sessions.</Text> : null}
            <View
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
              accessibilityLabel="Export full record as PDF (not available yet)"
              style={styles.export}
            >
              <Text style={styles.exportText}>Export full record (PDF)</Text>
            </View>
          </>
        )}
      </ScrollView>
      <BottomTabBar />
    </View>
  );
}

function SessionCard({ session, now, highlighted }: { session: SessionSummary; now: Date; highlighted: boolean }) {
  const body = (
    <View style={styles.cardPad}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle} numberOfLines={1}>{cardTitle(session.protocolId)}</Text>
        {highlighted ? (
          <Text style={styles.todayChip}>{dateChip(session.createdAt, now)}</Text>
        ) : (
          <Text style={styles.dateText}>{dateChip(session.createdAt, now)}</Text>
        )}
      </View>
      <Text style={styles.summary}>{summaryLine(session)}</Text>
    </View>
  );
  if (highlighted) return <View style={[styles.cardFlex, styles.highlight, shadows.highlight]}>{body}</View>;
  return (
    <GlassCard style={styles.cardFlex} fill={colors.glassStrong} ring={colors.hairline} radius={radii.lg} elevated={false} intensity={0}>
      {body}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingTop: 58, paddingBottom: 14, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.glassHeaderBar, borderBottomWidth: 1, borderBottomColor: colors.hairline,
  },
  countChip: {
    marginLeft: "auto", fontSize: 12, fontWeight: "600", color: colors.accent700, overflow: "hidden",
    paddingVertical: 6, paddingHorizontal: 11, borderRadius: 9, backgroundColor: colors.accent100,
    borderWidth: 1, borderColor: colors.accent300,
  },
  content: { paddingTop: 18, paddingHorizontal: 22, paddingBottom: 110 },
  loading: { paddingVertical: 30 },
  error: { color: colors.caution },
  empty: { color: colors.textFaint, fontSize: 13 },
  note: { marginTop: 14, textAlign: "center", fontSize: 11.5, color: colors.textFaint },

  timeline: { flexDirection: "row" },
  line: { position: "absolute", left: 19, top: 0, bottom: 0, width: 2 },
  cards: { flex: 1, gap: 11 },
  item: { flexDirection: "row", gap: 16 },
  bubbleWrap: { width: 40, height: 40 },
  bubbleRing: { position: "absolute", left: -4, top: -4, right: -4, bottom: -4, borderRadius: 17, backgroundColor: colors.bg },
  bubble: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  bubbleText: { fontSize: 14, fontWeight: "600" },

  cardFlex: { flex: 1, minWidth: 0 },
  highlight: { borderRadius: radii.lg, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.accent400 },
  cardPad: { paddingVertical: 14, paddingHorizontal: 15 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { flexShrink: 1, fontSize: 14, fontWeight: "600", letterSpacing: -0.14, color: colors.text },
  todayChip: {
    marginLeft: "auto", fontSize: 11, fontWeight: "600", color: colors.accent700, overflow: "hidden",
    paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: colors.accent100,
  },
  dateText: { marginLeft: "auto", fontSize: 11.5, color: colors.textFaint },
  summary: { marginTop: 7, fontSize: 12.5, lineHeight: 18.1, color: colors.textMuted },
  export: {
    marginTop: 18, alignSelf: "center", height: 42, paddingHorizontal: 20, borderRadius: radii.md, opacity: 0.5,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.white, borderWidth: 1, borderColor: colors.accent300,
  },
  exportText: { fontSize: 13, fontWeight: "600", color: colors.accent700 },
});
