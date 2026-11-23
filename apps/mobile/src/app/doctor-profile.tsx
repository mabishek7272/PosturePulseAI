import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getClinicianProfile, saveClinicianProfile, type ClinicianProfile } from "../api/clinician";
import { UnauthorizedError } from "../api/http";
import { getClinicianToken } from "../auth/tokenStore";
import { PrimaryButton } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { BackButton } from "../components/ScreenHeader";
import { SignaturePad } from "../components/SignaturePad";
import { buildProfileInput, draftFromProfile, EMPTY_DRAFT, profileProblems, type ProfileDraft } from "../lib/doctorProfile";
import type { Stroke } from "../lib/signature";
import { colors } from "../theme/colors";

/** Height of SignaturePad's own box (it is fixed at 150). */
const PAD_HEIGHT = 150;

/**
 * The one-time doctor profile: name, specialty and licence number, plus a drawn signature. It is
 * stamped on every patient the doctor registers and frozen into every report they sign. Shown right
 * after the first sign-in (`?setup=1`) and reachable later from Settings.
 */
export default function DoctorProfileScreen() {
  const insets = useSafeAreaInsets();
  const { setup } = useLocalSearchParams<{ setup?: string }>();
  const isSetup = setup === "1";

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ClinicianProfile | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_DRAFT);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [padWidth, setPadWidth] = useState(300);
  const [redraw, setRedraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getClinicianToken();
        if (!token) return router.replace("/login");
        const loaded = await getClinicianProfile(token);
        if (!cancelled) {
          setProfile(loaded);
          setDraft(draftFromProfile(loaded));
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) return router.replace("/login");
        // Not blocking: the form still works from empty, and saving will say if something is wrong.
        setError(err instanceof Error ? err.message : "Could not load your profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (key: keyof ProfileDraft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const hasSignatureOnFile = Boolean(profile?.hasSignature) && !redraw;

  async function save() {
    if (busy) return;
    const problems = profileProblems(draft, hasSignatureOnFile, strokes);
    if (problems.length > 0) {
      setError(problems.join(" "));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await getClinicianToken();
      if (!token) return router.replace("/login");
      const saved = await saveClinicianProfile(buildProfileInput(draft, strokes, padWidth, PAD_HEIGHT), token);
      setProfile(saved);
      setStrokes([]);
      setRedraw(false);
      if (isSetup) router.replace("/permissions");
      else router.back();
    } catch (err) {
      if (err instanceof UnauthorizedError) return router.replace("/login");
      setError(err instanceof Error ? err.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          scrollEnabled={!drawing}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, paddingTop: Math.max(24, insets.top + 8), paddingBottom: Math.max(32, insets.bottom + 16) }}
        >
          <View style={styles.headerRow}>
            {!isSetup && <BackButton />}
            <Text accessibilityRole="header" style={styles.h1}>{isSetup ? "Set up your doctor profile" : "Doctor profile"}</Text>
          </View>
          <Text style={styles.lede}>
            Your name, licence number and signature are printed on every report you sign and recorded against every patient you register.
            They are asked for once.
          </Text>

          {loading ? (
            <ActivityIndicator color={colors.accent700} style={{ marginTop: 32 }} />
          ) : (
            <GlassCard fill={colors.glassStrong} radius={18} intensity={30}>
              <View style={styles.card}>
                <Text style={styles.requiredLabel}>Required</Text>
                <TextInput style={styles.input} placeholder="Full name" placeholderTextColor={colors.textFaint} autoCapitalize="words" value={draft.fullName} onChangeText={set("fullName")} />
                <TextInput style={styles.input} placeholder="Specialty (e.g. Physiotherapy)" placeholderTextColor={colors.textFaint} autoCapitalize="words" value={draft.specialty} onChangeText={set("specialty")} />
                <TextInput style={styles.input} placeholder="Licence / registration number" placeholderTextColor={colors.textFaint} autoCapitalize="characters" autoCorrect={false} value={draft.licenceNumber} onChangeText={set("licenceNumber")} />

                <Text style={styles.fieldLabel}>Signature</Text>
                {hasSignatureOnFile ? (
                  <View style={styles.onFile}>
                    <Text style={styles.onFileText}>A signature is on file.</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="Draw a new signature" onPress={() => setRedraw(true)} hitSlop={8}>
                      <Text style={styles.link}>Draw a new one</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View onLayout={(e) => setPadWidth(e.nativeEvent.layout.width)}>
                    <SignaturePad strokes={strokes} onChange={setStrokes} onDrawingChange={setDrawing} disabled={busy} />
                    {redraw && (
                      <Pressable onPress={() => { setRedraw(false); setStrokes([]); }} hitSlop={8}>
                        <Text style={[styles.link, { marginTop: 8 }]}>Keep the signature on file</Text>
                      </Pressable>
                    )}
                  </View>
                )}

                <Text style={[styles.requiredLabel, { marginTop: 18 }]}>Optional</Text>
                <TextInput style={styles.input} placeholder="Qualifications" placeholderTextColor={colors.textFaint} value={draft.qualifications} onChangeText={set("qualifications")} />
                <TextInput style={styles.input} placeholder="Licensing authority" placeholderTextColor={colors.textFaint} value={draft.licensingAuthority} onChangeText={set("licensingAuthority")} />
                <TextInput style={styles.input} placeholder="Clinic / hospital" placeholderTextColor={colors.textFaint} value={draft.clinic} onChangeText={set("clinic")} />
                <TextInput style={styles.input} placeholder="Professional contact" placeholderTextColor={colors.textFaint} keyboardType="email-address" autoCapitalize="none" value={draft.professionalContact} onChangeText={set("professionalContact")} />

                {error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
                <PrimaryButton label={isSetup ? "Save and continue" : "Save profile"} onPress={save} loading={busy} />
                {isSetup && (
                  <Pressable onPress={() => router.replace("/permissions")} disabled={busy} hitSlop={8}>
                    <Text style={styles.later}>Do this later</Text>
                    <Text style={styles.laterNote}>You will not be able to sign reports or register patients until it is complete.</Text>
                  </Pressable>
                )}
              </View>
            </GlassCard>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  h1: { color: colors.text, fontSize: 22, fontWeight: "700", flexShrink: 1 },
  lede: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 18 },
  card: { padding: 16 },
  requiredLabel: { color: colors.accent700, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 8 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 4, marginBottom: 8 },
  input: {
    height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.white,
    paddingHorizontal: 14, color: colors.text, fontSize: 14, marginBottom: 10,
  },
  onFile: {
    borderRadius: 12, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.bgTint, padding: 14,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  onFileText: { color: colors.textBody, fontSize: 13 },
  link: { color: colors.accent700, fontSize: 13, fontWeight: "600" },
  error: { color: "#b3261e", fontSize: 13, marginVertical: 10 },
  later: { color: colors.textMuted, fontSize: 13, fontWeight: "600", textAlign: "center", marginTop: 14 },
  laterNote: { color: colors.textFaint, fontSize: 11.5, textAlign: "center", marginTop: 4 },
});
