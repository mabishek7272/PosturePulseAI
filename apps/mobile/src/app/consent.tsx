import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { linkPatient } from "../api/patients";
import {
  createConsentRecord,
  createSession,
  getAssessmentBattery,
  type SessionCredentials,
} from "../api/sessions";
import { getClinicianToken } from "../auth/tokenStore";
import { MAX_CONTENT_WIDTH, useResponsive } from "../components/Screen";
import { colors } from "../theme/colors";

export default function ConsentScreen() {
  const { titleSize, bodySize, gutter } = useResponsive();
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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingHorizontal: gutter, maxWidth: MAX_CONTENT_WIDTH + gutter * 2 }]}>
      <Text style={styles.eyebrow}>STEP 2 OF 3</Text>
      <Text style={[styles.title, { fontSize: titleSize }]}>Consent</Text>
      <Text style={styles.name}>{patientName}</Text>

      <View style={styles.card}>
        <Text style={[styles.body, { fontSize: bodySize, lineHeight: bodySize * 1.55 }]}>
          Short video clips of four standing poses will be recorded and uploaded to this clinic's
          server, where body landmarks are measured. Video is not retained after measurement.
          Measurements are camera-based estimates reviewed by a clinician, and are not a substitute
          for clinical examination.
        </Text>
        <Text style={[styles.body, { fontSize: bodySize, lineHeight: bodySize * 1.55 }]}>
          The recording can be stopped at any time, and the assessment can be ended on request.
        </Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={agree} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.textOnDark} /> : <Text style={styles.buttonText}>Consent given — begin</Text>}
      </Pressable>
      <Pressable onPress={() => router.back()} disabled={busy} hitSlop={12}>
        <Text style={styles.back}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  back: { color: colors.textFaint, textAlign: "center", marginTop: 24 },
  screen: { flex: 1, backgroundColor: colors.bgDeep },
  content: { paddingTop: 60, paddingBottom: 24, width: "100%", alignSelf: "center" },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 2, color: colors.accent600, marginBottom: 8 },
  title: { color: colors.text, fontWeight: "600" },
  name: { color: colors.accent700, fontSize: 16, marginTop: 4, marginBottom: 20 },
  card: {
    padding: 18, borderRadius: 18, gap: 12, marginBottom: 20,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
  },
  body: { color: colors.textMuted },
  error: { color: colors.caution, marginBottom: 12 },
  button: { backgroundColor: colors.accent700, borderRadius: 13, padding: 17, alignItems: "center", marginTop: 12 },
  buttonText: { color: colors.textOnDark, fontWeight: "700", fontSize: 16 },
});
