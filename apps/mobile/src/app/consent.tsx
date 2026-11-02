import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { linkPatient } from "../api/patients";
import { createConsentRecord, createSession, getAssessmentBattery } from "../api/sessions";
import { getClinicianToken } from "../auth/tokenStore";

export default function ConsentScreen() {
  const { patientId, patientName } = useLocalSearchParams<{ patientId: string; patientName: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function agree() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getClinicianToken();
      if (!token) return router.replace("/login");

      // A fresh pseudonymous id per visit - the clinic device is shared (ADR-012).
      const subjectPseudoId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const battery = await getAssessmentBattery();
      const consent = await createConsentRecord(subjectPseudoId);
      const credentials = await createSession({
        subjectPseudoId,
        consentRecordId: consent.consentRecordId,
        protocolVersion: battery.version,
      });
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Consent</Text>
      <Text style={styles.name}>{patientName}</Text>
      <Text style={styles.body}>
        Short video clips of four standing poses will be recorded and uploaded to this clinic's
        server, where body landmarks are measured. Video is not retained after measurement.
        Measurements are camera-based estimates reviewed by a clinician, and are not a substitute
        for clinical examination.
      </Text>
      <Text style={styles.body}>
        The recording can be stopped at any time, and the assessment can be ended on request.
      </Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={agree} disabled={busy}>
        {busy ? <ActivityIndicator color="#0e0a16" /> : <Text style={styles.buttonText}>Consent given — begin</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0e0a16" },
  content: { padding: 24, paddingTop: 60 },
  title: { color: "#efeaf6", fontSize: 26, fontWeight: "800" },
  name: { color: "#b98cff", fontSize: 16, marginTop: 4, marginBottom: 20 },
  body: { color: "#9d93ae", fontSize: 15, lineHeight: 23, marginBottom: 16 },
  error: { color: "#ff6b6b", marginBottom: 12 },
  button: { backgroundColor: "#b98cff", borderRadius: 12, padding: 17, alignItems: "center", marginTop: 12 },
  buttonText: { color: "#0e0a16", fontWeight: "700", fontSize: 16 },
});
