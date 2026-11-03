import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Line } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { linkPatient } from "../api/patients";
import {
  createConsentRecord,
  createSession,
  getAssessmentBattery,
  type SessionCredentials,
} from "../api/sessions";
import { getClinicianToken } from "../auth/tokenStore";
import { Avatar } from "../components/Avatar";
import { PrimaryButton } from "../components/Buttons";
import { CheckIcon } from "../components/icons";
import { GlassCard } from "../components/GlassCard";
import { MAX_CONTENT_WIDTH, useResponsive } from "../components/Screen";
import { ScreenHeader } from "../components/ScreenHeader";
import { initialsOf } from "../lib/homeData";
import { colors } from "../theme/colors";
import { radii } from "../theme/radii";

// Reviewed consent copy - word-for-word, split only at existing sentence boundaries.
const CONSENT_POINTS = [
  "Short video clips of four standing poses will be recorded and uploaded to this clinic's server, where body landmarks are measured.",
  "Video is not retained after measurement.",
  "Measurements are camera-based estimates reviewed by a clinician, and are not a substitute for clinical examination.",
  "The recording can be stopped at any time, and the assessment can be ended on request.",
];

export default function ConsentScreen() {
  const { gutter } = useResponsive();
  const insets = useSafeAreaInsets();
  const { patientId, patientName } = useLocalSearchParams<{ patientId: string; patientName: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Held across retries so a mid-flow failure resumes the same visit instead of
  // creating a second consent record and session. A new visit is a new screen
  // instance and therefore a fresh id. In memory only: the session token is never persisted.
  const subjectPseudoIdRef = useRef<string | null>(null);
  const consentRecordIdRef = useRef<string | null>(null);
  const credentialsRef = useRef<SessionCredentials | null>(null);

  async function agree() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getClinicianToken();
      if (!token) return router.replace("/login");

      // A fresh pseudonymous id per visit - the clinic device is shared (ADR-012).
      subjectPseudoIdRef.current ??= `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const subjectPseudoId = subjectPseudoIdRef.current;
      if (!credentialsRef.current) {
        const battery = await getAssessmentBattery();
        if (!consentRecordIdRef.current) {
          consentRecordIdRef.current = (await createConsentRecord(subjectPseudoId)).id;
        }
        credentialsRef.current = await createSession({
          subjectPseudoId,
          consentRecordId: consentRecordIdRef.current,
          protocolVersion: battery.version,
        });
      }
      const credentials = credentialsRef.current;

      // Link must run after createSession: the endpoint 404s unless a session already
      // exists for this subject id. Repeat links to the same patient are idempotent,
      // so a retry after a failed link safely re-runs only this step.
      await linkPatient(patientId, subjectPseudoId, token);

      router.replace({
        pathname: "/capture",
        params: {
          sessionId: credentials.session.id,
          sessionToken: credentials.sessionToken,
          patientName,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the assessment.");
    } finally {
      setBusy(false);
    }
  }

  const column = { maxWidth: MAX_CONTENT_WIDTH + gutter * 2, width: "100%", alignSelf: "center" } as const;
  return (
    <View style={styles.screen}>
      <View style={[column, { paddingHorizontal: gutter - 2 }]}>
        <ScreenHeader
          title="Consent"
          eyebrow="Step 2 of 3"
          step={{ current: 2, total: 3 }}
          backVariant="tint"
          paddingTop={insets.top + 14}
          onBack={busy ? () => {} : undefined}
        />
      </View>
      <ScrollView style={styles.flex} contentContainerStyle={[styles.content, column, { paddingHorizontal: gutter - 2 }]}>
        <View style={styles.patientCard}>
          <Avatar initials={initialsOf(patientName ?? "")} size={40} variant="solid" radius={13} />
          <Text style={styles.patientName} numberOfLines={1}>{patientName}</Text>
        </View>

        <GlassCard fill={colors.glassStrong} intensity={36} style={styles.agree}>
          <View style={styles.agreeInner}>
            <Text style={styles.agreeTitle}>What the patient is agreeing to</Text>
            {CONSENT_POINTS.map((text) => (
              <View key={text} style={styles.bullet}>
                <View style={styles.bulletDot}>
                  <CheckIcon size={12} color={colors.accent700} />
                </View>
                <Text style={styles.bulletText}>{text}</Text>
              </View>
            ))}
          </View>
        </GlassCard>

        <View style={styles.sigWrap}>
          <Text style={styles.sigLabel}>Patient signature</Text>
          <View style={styles.sigPad} accessibilityLabel="Signature capture is not available yet">
            <View style={styles.sigLine}>
              <Svg width="100%" height={1} style={styles.sigSvg}>
                <Line x1="0" y1="0.5" x2="100%" y2="0.5" stroke={colors.hairlineStrong} strokeWidth={1} strokeDasharray="3 4" />
              </Svg>
            </View>
            <Text style={styles.sigNote}>Signature capture is not available yet</Text>
            <View style={styles.clear} accessibilityRole="button" accessibilityState={{ disabled: true }}>
              <Text style={styles.clearText}>Clear</Text>
            </View>
          </View>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 16) + 14 }]}>
        <View style={[column, { paddingHorizontal: gutter - 2 }]}>
          <PrimaryButton label="Record consent & start capture" onPress={agree} loading={busy} disabled={busy} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  flex: { flex: 1 },
  content: { paddingTop: 8, paddingBottom: 24, gap: 13 },
  patientCard: {
    flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 15,
    borderRadius: radii.lg, backgroundColor: colors.accent100, borderWidth: 1, borderColor: colors.accent300,
  },
  patientName: { flexShrink: 1, fontSize: 14.5, fontWeight: "600", letterSpacing: -0.15, color: colors.text },
  agree: { borderRadius: radii.card },
  agreeInner: { paddingVertical: 18, paddingHorizontal: 17, gap: 13 },
  agreeTitle: { fontSize: 13, fontWeight: "600", letterSpacing: -0.13, color: colors.text },
  bullet: { flexDirection: "row", gap: 11 },
  bulletDot: {
    width: 20, height: 20, marginTop: 1, borderRadius: 10, backgroundColor: colors.accent200,
    alignItems: "center", justifyContent: "center",
  },
  bulletText: { flex: 1, fontSize: 13, lineHeight: 19.5, color: colors.textBody },
  sigWrap: { gap: 9 },
  sigLabel: { fontSize: 12, fontWeight: "600", letterSpacing: 0.24, color: colors.textSecondary },
  sigPad: {
    height: 150, borderRadius: radii.lg, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.hairline,
    overflow: "hidden", alignItems: "center", justifyContent: "center",
  },
  sigLine: { position: "absolute", left: 34, right: 34, top: 124, height: 1 },
  sigSvg: { position: "absolute" },
  sigNote: { fontSize: 12, color: colors.textFaint },
  clear: {
    position: "absolute", right: 11, top: 11, height: 30, paddingHorizontal: 11, borderRadius: radii.sm,
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline, justifyContent: "center", opacity: 0.5,
  },
  clearText: { fontSize: 11.5, fontWeight: "600", color: colors.textMuted },
  error: { color: colors.caution, fontSize: 13 },
  bar: {
    paddingTop: 14, backgroundColor: colors.glassStrong, borderTopWidth: 1, borderTopColor: colors.hairline,
  },
});
