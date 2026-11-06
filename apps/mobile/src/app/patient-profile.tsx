import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { UnauthorizedError } from "../api/http";
import { getPatient, listPatientSessions, type PatientRecord, type PatientSession } from "../api/patients";
import { getClinicianToken } from "../auth/tokenStore";
import { Avatar } from "../components/Avatar";
import { BottomTabBar } from "../components/BottomTabBar";
import { PrimaryButton } from "../components/Buttons";
import { FadeUp } from "../components/FadeUp";
import { GlassCard } from "../components/GlassCard";
import { ChevronRightIcon } from "../components/icons";
import { BackButton } from "../components/ScreenHeader";
import { cardTitle, dateChip, stateLabel } from "../lib/historyData";
import { initialsOf, patientMeta } from "../lib/homeData";
import { intakeLines, scanCountLabel } from "../lib/patientProfile";
import { colors } from "../theme/colors";
import { radii } from "../theme/radii";
import { type } from "../theme/typography";

/**
 * One patient: who they are, what the clinician recorded at intake, and every
 * scan linked to them (newest first). Tapping a scan opens its report; "New
 * scan" starts a visit for this patient (consent first, then capture).
 */
export default function PatientProfileScreen() {
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const now = useMemo(() => new Date(), []);
  const [patient, setPatient] = useState<PatientRecord | null>(null);
  const [sessions, setSessions] = useState<PatientSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reloaded on focus, so a scan finished a moment ago shows up on return.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const token = await getClinicianToken();
          if (!token) return router.replace("/login");
          const [p, s] = await Promise.all([getPatient(patientId, token), listPatientSessions(patientId, token)]);
          if (!cancelled) {
            setPatient(p);
            setSessions(s);
            setError(null);
          }
        } catch (err) {
          if (cancelled) return;
          if (err instanceof UnauthorizedError) return router.replace("/login");
          setError(err instanceof Error ? err.message : "Could not load this patient.");
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [patientId]),
  );

  function newScan() {
    if (!patient) return;
    router.push({ pathname: "/consent", params: { patientId: patient.id, patientName: patient.name } });
  }

  const intake = intakeLines(patient?.intake);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <BackButton />
        <Text accessibilityRole="header" style={type.headerTitle}>Patient</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!patient && !error ? <ActivityIndicator color={colors.accent600} style={styles.loading} /> : null}

        {patient ? (
          <>
            <FadeUp>
              <GlassCard radius={radii.lg} fill={colors.glassStrong} ring={colors.hairline} elevated={false} intensity={0}>
                <View style={styles.identity}>
                  <Avatar initials={initialsOf(patient.name)} size={56} variant="solid" />
                  <View style={styles.flex}>
                    <Text style={styles.name} numberOfLines={2}>{patient.name}</Text>
                    <Text style={styles.meta}>{patientMeta(patient.dateOfBirth, now)}</Text>
                    {patient.contact ? <Text style={styles.meta} numberOfLines={1}>{patient.contact}</Text> : null}
                  </View>
                </View>
                {intake.length > 0 ? (
                  <View style={styles.intake}>
                    {intake.map((line) => (
                      <View key={line.label} style={styles.intakeRow}>
                        <Text style={styles.intakeLabel}>{line.label}</Text>
                        <Text style={styles.intakeValue}>{line.value}</Text>
                      </View>
                    ))}
                    <Text style={styles.note}>Intake as entered by the clinician. Not used in any measurement.</Text>
                  </View>
                ) : null}
              </GlassCard>
            </FadeUp>

            <FadeUp delay={100} style={styles.action}>
              <PrimaryButton label="New scan" height={52} radius={13} sheen onPress={newScan} />
            </FadeUp>

            <FadeUp delay={160}>
              <View style={styles.sectionHead}>
                <Text style={styles.section}>Previous scans</Text>
                {sessions ? <Text style={styles.count}>{scanCountLabel(sessions.length)}</Text> : null}
              </View>
              {sessions === null ? (
                <ActivityIndicator color={colors.accent600} style={styles.loading} />
              ) : sessions.length === 0 ? (
                <Text style={styles.empty}>No scans yet for this patient.</Text>
              ) : (
                <View style={styles.list}>
                  {sessions.map((s) => (
                    <Pressable
                      key={s.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Open the report for the scan on ${dateChip(s.createdAt, now)}`}
                      onPress={() => router.push({ pathname: "/results", params: { sessionId: s.id } })}
                      style={({ pressed }) => [pressed && styles.pressed]}
                    >
                      <GlassCard radius={radii.md} fill={colors.glassStrong} ring={colors.hairline} elevated={false} intensity={0}>
                        <View style={styles.scanRow}>
                          <View style={styles.flex}>
                            <Text style={styles.scanTitle} numberOfLines={1}>{cardTitle(s.protocolId)}</Text>
                            <Text style={styles.meta}>{`${dateChip(s.createdAt, now)} · ${stateLabel(s.state)}`}</Text>
                          </View>
                          <ChevronRightIcon size={18} color={colors.textFaint} />
                        </View>
                      </GlassCard>
                    </Pressable>
                  ))}
                </View>
              )}
            </FadeUp>
          </>
        ) : null}
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
  content: { paddingTop: 18, paddingHorizontal: 22, paddingBottom: 120, gap: 16, maxWidth: 640, width: "100%", alignSelf: "center" },
  loading: { paddingVertical: 30 },
  error: { color: colors.caution, fontSize: 14 },
  identity: { flexDirection: "row", gap: 14, alignItems: "center", padding: 16 },
  flex: { flex: 1 },
  name: { fontSize: 20, fontWeight: "600", color: colors.text, letterSpacing: -0.4 },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  intake: { borderTopWidth: 1, borderTopColor: colors.hairline, paddingHorizontal: 16, paddingVertical: 12, gap: 6 },
  intakeRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  intakeLabel: { fontSize: 13, color: colors.textSecondary },
  intakeValue: { fontSize: 13, color: colors.text, fontWeight: "500", flexShrink: 1, textAlign: "right" },
  note: { fontSize: 11, color: colors.textFaint, marginTop: 4 },
  action: { marginTop: 2 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 },
  section: { fontSize: 16, fontWeight: "600", color: colors.text },
  count: { fontSize: 12, color: colors.textMuted },
  empty: { fontSize: 14, color: colors.textMuted, paddingVertical: 12 },
  list: { gap: 10 },
  scanRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13, paddingHorizontal: 15 },
  scanTitle: { fontSize: 14.5, fontWeight: "600", color: colors.text },
  pressed: { opacity: 0.7 },
});
