import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { listSessions, type SessionSummary } from "../api/sessions-list";
import { getClinicianToken } from "../auth/tokenStore";
import { Avatar } from "../components/Avatar";
import { BottomTabBar } from "../components/BottomTabBar";
import { DriftingBlobs } from "../components/DriftingBlobs";
import { FadeUp } from "../components/FadeUp";
import { GlassCard } from "../components/GlassCard";
import { ArrowRightIcon, BellIcon, SparkleIcon } from "../components/icons";
import { GrowBar, GrowWidth, PulseDot, RingPulse } from "../components/Motion";
import { barFractions, formatLongDate, homeStats, initialsOf, relativeDate, usernameFromToken } from "../lib/homeData";
import { colors, gradients } from "../theme/colors";
import { radii } from "../theme/radii";
import { shadows } from "../theme/shadows";

const STATE_LABEL: Record<string, string> = {
  Setup: "Setting up",
  Observing: "In progress",
  Pause: "Paused",
  ClinicianReview: "Needs review",
};

const HERO_BLOB = [{ size: 220, right: -70, top: -80, color: colors.accent400, duration: 15, variant: 2 as const, opacity: 0.45 }];
const BAR_COLORS = [colors.accent300, colors.accent300, colors.accent300, colors.accent400, colors.accent600];

export default function HomeScreen() {
  const now = useMemo(() => new Date(), []);
  const [username, setUsername] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getClinicianToken();
        if (!token) return router.replace("/login");
        if (!cancelled) setUsername(usernameFromToken(token));
        const found = await listSessions(token, 100);
        if (!cancelled) setSessions(found);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load sessions.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => (sessions ? homeStats(sessions, now) : null), [sessions, now]);
  const recent = sessions?.slice(0, 3) ?? [];
  const last = sessions?.[0];
  const heroEyebrow = last ? `LAST ASSESSMENT · ${relativeDate(last.createdAt, now).toUpperCase()}` : "READY TO ASSESS";
  const bars = barFractions(stats?.bars ?? [0, 0, 0, 0, 0]);
  const todayPct = stats && stats.today > 0 ? (stats.todayStarted / stats.today) * 100 : 0;

  return (
    <View style={styles.root}>
      <DriftingBlobs />
      <View style={styles.flex}>
        <FadeUp style={styles.header}>
          <Avatar initials={initialsOf(username ?? "Clinician")} size={44} variant="solid" />
          <View style={styles.headerText}>
            <Text style={styles.date}>{formatLongDate(now)}</Text>
            <Text style={styles.name} numberOfLines={1}>{username ?? "Clinician"}</Text>
          </View>
          <View
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            accessibilityLabel="Notifications (not available)"
            style={styles.bell}
          >
            <BellIcon size={18} color={colors.textSecondary} />
          </View>
        </FadeUp>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <FadeUp delay={80}>
            <View style={[shadows.hero, styles.heroShadow]}>
              <LinearGradient
                colors={gradients.hero}
                locations={[0, 0.55, 1]}
                start={{ x: 0.17, y: 0 }}
                end={{ x: 0.83, y: 1 }}
                style={styles.hero}
              >
                <DriftingBlobs blobs={HERO_BLOB} />
                <View style={styles.heroInner}>
                  <View style={styles.heroEyebrowRow}>
                    <PulseDot style={styles.heroDot} />
                    <Text style={styles.heroEyebrow}>{heroEyebrow}</Text>
                  </View>
                  <View style={styles.heroTexts}>
                    <Text style={styles.heroTitle}>Start an assessment</Text>
                    <Text style={styles.heroSub}>Choose a patient to begin</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Begin assessment"
                    onPress={() => router.push("/patient")}
                    style={({ pressed }) => [styles.heroButton, pressed && { backgroundColor: "rgba(255,255,255,0.24)" }]}
                  >
                    <Text style={styles.heroButtonText}>Begin assessment</Text>
                    <ArrowRightIcon size={16} color={colors.textOnDark} />
                  </Pressable>
                </View>
              </LinearGradient>
            </View>
          </FadeUp>

          <FadeUp delay={140} style={styles.statRow}>
            <GlassCard fill={colors.surface} ring={colors.accent200} radius={18} style={styles.flex}>
              <View style={styles.statPad}>
                <Text style={styles.statLabel}>TODAY</Text>
                <View style={[styles.statValueRow, { gap: 5 }]}>
                  <Text style={styles.statValue}>{stats ? stats.today : "—"}</Text>
                  <Text style={styles.statUnit}>sessions</Text>
                </View>
                <View style={styles.track}>
                  <GrowWidth pct={todayPct} style={styles.trackFill}>
                    <LinearGradient colors={gradients.progress} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                  </GrowWidth>
                </View>
              </View>
            </GlassCard>
            <GlassCard fill={colors.surface} ring={colors.accent200} radius={18} style={styles.flex}>
              <View style={styles.statPad}>
                <Text style={styles.statLabel}>THIS WEEK</Text>
                <View style={[styles.statValueRow, { gap: 6 }]}>
                  <Text style={styles.statValue}>{stats ? stats.week : "—"}</Text>
                  <Text style={styles.statUnit}>sessions</Text>
                </View>
                <View style={styles.bars}>
                  {bars.map((f, i) => (
                    <GrowBar
                      key={i}
                      height={f > 0 ? Math.max(3, f * 20) : 3}
                      delay={350 + i * 70}
                      style={[styles.bar, { backgroundColor: f > 0 ? BAR_COLORS[i] : colors.accent200 }]}
                    />
                  ))}
                </View>
              </View>
            </GlassCard>
          </FadeUp>

          <FadeUp delay={200}>
            <GlassCard fill={colors.glassTint} ring={colors.accent300} radius={18}>
              <View style={styles.pulsePad}>
                <View style={styles.pulseHead}>
                  <View style={styles.pulseIcon}>
                    <RingPulse duration={2800} style={styles.pulseRing} />
                    <SparkleIcon size={17} color={colors.accent700} />
                  </View>
                  <Text style={styles.pulseEyebrow}>PULSE AI · DAILY BRIEF</Text>
                </View>
                <Text style={styles.pulseBody}>Not available yet.</Text>
                <View
                  accessibilityRole="button"
                  accessibilityState={{ disabled: true }}
                  accessibilityLabel="Open cohort view (not available)"
                  style={[styles.pulseButton, { opacity: 0.5 }]}
                >
                  <Text style={styles.pulseButtonText}>Open cohort view</Text>
                  <ArrowRightIcon size={14} color={colors.accent700} />
                </View>
              </View>
            </GlassCard>
          </FadeUp>

          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Recent sessions</Text>
            <Pressable accessibilityRole="link" onPress={() => router.push("/history")} hitSlop={10}>
              <Text style={styles.sectionLink}>All sessions</Text>
            </Pressable>
          </View>

          <View style={styles.list}>
            {error ? (
              <Text style={styles.error}>{error}</Text>
            ) : sessions === null ? (
              <ActivityIndicator color={colors.accent600} style={styles.loading} />
            ) : recent.length === 0 ? (
              <Text style={styles.empty}>No sessions yet.</Text>
            ) : (
              recent.map((s) => (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  accessibilityHint="Opens this scan's report"
                  onPress={() => router.push({ pathname: "/results", params: { sessionId: s.id } })}
                >
                  {({ pressed }) => (
                    <GlassCard
                      fill={pressed ? colors.accent100 : colors.glassStrong}
                      radius={radii.lg}
                      elevated={false}
                      intensity={30}
                    >
                      <View style={styles.row}>
                        <Avatar initials={initialsOf(s.subjectPseudoId)} size={38} variant="soft" />
                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle} numberOfLines={1}>{s.subjectPseudoId}</Text>
                          <Text style={styles.rowSub}>{relativeDate(s.createdAt, now)}</Text>
                        </View>
                        <Text style={styles.rowChip}>{STATE_LABEL[s.state] ?? s.state}</Text>
                      </View>
                    </GlassCard>
                  )}
                </Pressable>
              ))
            )}
          </View>
        </ScrollView>
      </View>
      <BottomTabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { paddingTop: 58, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", gap: 13 },
  headerText: { gap: 2, flexShrink: 1 },
  date: { fontSize: 12, color: colors.textMuted },
  name: { fontSize: 16.5, fontWeight: "600", letterSpacing: -0.33, color: colors.text },
  bell: {
    marginLeft: "auto", width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.glassStrong, borderWidth: 1, borderColor: colors.hairline,
  },
  content: { paddingTop: 20, paddingHorizontal: 22, paddingBottom: 110, gap: 14 },

  heroShadow: { borderRadius: radii.hero },
  hero: { borderRadius: radii.hero, overflow: "hidden", padding: 20 },
  heroInner: { gap: 14 },
  heroEyebrowRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  heroDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent400 },
  heroEyebrow: { fontSize: 11, fontWeight: "600", letterSpacing: 1.54, color: colors.accent300 },
  heroTexts: { gap: 5 },
  heroTitle: { fontSize: 22, fontWeight: "600", letterSpacing: -0.66, color: colors.textOnDark },
  heroSub: { fontSize: 13, color: colors.accentSoft },
  heroButton: {
    alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, height: 46,
    paddingHorizontal: 20, borderRadius: radii.button, backgroundColor: colors.glassOnDark,
    borderWidth: 1, borderColor: colors.glassOnDarkRing,
  },
  heroButtonText: { fontSize: 14, fontWeight: "600", color: colors.textOnDark },

  statRow: { flexDirection: "row", gap: 11 },
  statPad: { padding: 16 },
  statLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 1.32, color: colors.textMuted },
  statValueRow: { marginTop: 8, flexDirection: "row", alignItems: "baseline" },
  statValue: { fontSize: 30, fontWeight: "600", letterSpacing: -1.2, color: colors.text },
  statUnit: { fontSize: 13, color: colors.textMuted },
  track: { marginTop: 11, height: 5, borderRadius: 3, backgroundColor: colors.accent200, overflow: "hidden" },
  trackFill: { height: "100%", borderRadius: 3, overflow: "hidden" },
  bars: { marginTop: 9, height: 20, flexDirection: "row", alignItems: "flex-end", gap: 3 },
  bar: { flex: 1, borderRadius: 2 },

  pulsePad: { paddingVertical: 17, paddingHorizontal: 16 },
  pulseHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  pulseIcon: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  pulseRing: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 15,
    borderWidth: 1, borderColor: colors.accentRing,
  },
  pulseEyebrow: { fontSize: 11, fontWeight: "600", letterSpacing: 1.43, color: colors.accent700 },
  pulseBody: { marginTop: 11, fontSize: 13.5, lineHeight: 20.9, color: colors.textBody },
  pulseButton: {
    marginTop: 13, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 7, height: 38,
    paddingHorizontal: 15, borderRadius: 11, backgroundColor: colors.white,
    borderWidth: 1, borderColor: colors.accent300,
  },
  pulseButtonText: { fontSize: 13, fontWeight: "600", color: colors.accent700 },

  sectionHead: { marginTop: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 13, fontWeight: "600", letterSpacing: -0.13, color: colors.text },
  sectionLink: { fontSize: 12.5, fontWeight: "500", color: colors.accent600 },
  list: { gap: 9 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 15 },
  rowText: { gap: 2, flexShrink: 1 },
  rowTitle: { fontSize: 14.5, fontWeight: "600", letterSpacing: -0.145, color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted },
  rowChip: {
    marginLeft: "auto", fontSize: 11, fontWeight: "600", color: colors.accent700, overflow: "hidden",
    paddingVertical: 5, paddingHorizontal: 9, borderRadius: 7, backgroundColor: colors.accent100,
  },
  loading: { paddingVertical: 20 },
  error: { color: colors.caution },
  empty: { color: colors.textFaint, fontSize: 13 },
});
