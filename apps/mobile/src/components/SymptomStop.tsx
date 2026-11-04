import { useCallback, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  reportSymptom,
  SEVERITIES,
  SYMPTOMS,
  type Severity,
  type Symptom,
} from "../api/symptoms";
import { colors } from "../theme/colors";
import { radii } from "../theme/radii";

/**
 * The patient-facing stop. Always visible while a capture screen is open.
 *
 * **The stop is local and immediate; the report is sent afterwards.** Pressing
 * the button calls `onStop` synchronously before anything else happens, and
 * nothing below can delay or prevent it - no network call, no validation, no
 * confirmation dialog. `docs/regulatory/usability-engineering-file.md` names the
 * hazard as "delayed or failed stop during an adverse symptom" and the control
 * as local-first, and CLAUDE.md rule 2 puts a symptom report above every other
 * signal in the system. A patient who feels unwell must not be waiting on a
 * round-trip, and must not be able to fail to stop because a form was
 * incomplete.
 *
 * What follows the stop is detail-gathering, and it is skippable. "Stopped -
 * tell the clinician nothing more" is a valid outcome: the recording has
 * already ended, and a patient in distress should not be held in a form.
 * Sending the report is what pauses the SESSION server-side, which is what
 * blocks further clip uploads (`UPLOAD_BLOCKED_STATES`), so the two are
 * genuinely separate consequences and the copy says so.
 */
export function SymptomStop({
  sessionId,
  sessionToken,
  onStop,
  onPaused,
}: {
  sessionId: string;
  sessionToken?: string;
  /**
   * Halts the recording. Called FIRST, synchronously, on press. Must be
   * local-only and must not throw.
   */
  onStop: () => void;
  /** Called once the server has confirmed the session is paused. */
  onPaused?: (state: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [symptoms, setSymptoms] = useState<Symptom[]>([]);
  const [severity, setSeverity] = useState<Severity>("moderate");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const press = useCallback(() => {
    // THE STOP. Before the sheet, before any state that could fail.
    onStop();
    setOpen(true);
  }, [onStop]);

  const toggle = (s: Symptom) =>
    setSymptoms((current) => (current.includes(s) ? current.filter((x) => x !== s) : [...current, s]));

  const send = async () => {
    if (symptoms.length === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await reportSymptom({
        sessionId,
        symptoms,
        severity,
        freeText: note.trim() === "" ? null : note.trim(),
        token: sessionToken,
      });
      setSent(result.state);
      onPaused?.(result.state);
    } catch (e) {
      // The recording is already stopped, so this failure is about the
      // CLINICIAN not being told - the copy must say which of the two happened,
      // or the patient cannot know whether to speak to someone.
      setError(e instanceof Error ? e.message : "The report could not be sent.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop - I do not feel well"
        onPress={press}
        style={[styles.button, { top: insets.top + 8 }]}
        hitSlop={12}
      >
        <Text style={styles.buttonText}>Stop</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.scrim}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <ScrollView contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
              <Text accessibilityRole="header" style={styles.title}>
                Recording stopped
              </Text>

              {sent ? (
                <>
                  <Text style={styles.body}>
                    The clinician has been told and this session is paused. A member of staff will come to
                    you.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setOpen(false)}
                    style={styles.primary}
                  >
                    <Text style={styles.primaryText}>Close</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.body}>
                    The recording has already stopped. If you can, tell us what you felt - it helps the
                    clinician. You can close this instead.
                  </Text>

                  <Text style={styles.label}>What are you feeling?</Text>
                  <View style={styles.chips}>
                    {SYMPTOMS.map((s) => {
                      const on = symptoms.includes(s);
                      return (
                        <Pressable
                          key={s}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                          accessibilityLabel={SYMPTOM_WORDS[s]}
                          onPress={() => toggle(s)}
                          style={[styles.chip, on && styles.chipOn]}
                        >
                          <Text style={[styles.chipText, on && styles.chipTextOn]}>
                            {SYMPTOM_WORDS[s]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={styles.label}>How strong is it?</Text>
                  <View style={styles.chips}>
                    {SEVERITIES.map((s) => (
                      <Pressable
                        key={s}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: severity === s }}
                        accessibilityLabel={SEVERITY_WORDS[s]}
                        onPress={() => setSeverity(s)}
                        style={[styles.chip, severity === s && styles.chipOn]}
                      >
                        <Text style={[styles.chipText, severity === s && styles.chipTextOn]}>
                          {SEVERITY_WORDS[s]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.label}>Anything else? (optional)</Text>
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    multiline
                    style={styles.input}
                    accessibilityLabel="Anything else you want to tell the clinician"
                    placeholder="In your own words"
                    placeholderTextColor={colors.textFaint}
                  />

                  {error ? (
                    <Text style={styles.error}>
                      {`${error}\n\nThe recording is stopped. Please tell a member of staff directly.`}
                    </Text>
                  ) : null}

                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: symptoms.length === 0 || sending }}
                    disabled={symptoms.length === 0 || sending}
                    onPress={send}
                    style={[styles.primary, (symptoms.length === 0 || sending) && styles.primaryOff]}
                  >
                    <Text style={styles.primaryText}>
                      {sending ? "Sending..." : "Tell the clinician"}
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setOpen(false)}
                    style={styles.secondary}
                  >
                    <Text style={styles.secondaryText}>Close without sending</Text>
                  </Pressable>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

/**
 * Plain words for the schema's enum values. The patient never sees the machine
 * value, and nothing here names a condition or implies a cause - these describe
 * a sensation the person is reporting, not a finding the app has made.
 */
const SYMPTOM_WORDS: Record<Symptom, string> = {
  pain: "Pain",
  dizziness: "Dizzy or light-headed",
  weakness: "Weak or unsteady",
  breathlessness: "Short of breath",
  other: "Something else",
};

const SEVERITY_WORDS: Record<Severity, string> = {
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
};

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    right: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.accent700,
    zIndex: 50,
  },
  buttonText: { color: colors.accent900, fontSize: 16, fontWeight: "800" },
  scrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surfaceSolid,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: "88%",
  },
  sheetBody: { paddingHorizontal: 20, paddingTop: 20, gap: 10 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  body: { fontSize: 15, lineHeight: 21, color: colors.textBody },
  label: { fontSize: 13, fontWeight: "700", color: colors.textSecondary, marginTop: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.bgTint,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  chipOn: { backgroundColor: colors.accent200, borderColor: colors.accent400 },
  chipText: { fontSize: 15, color: colors.textBody },
  chipTextOn: { color: colors.accent900, fontWeight: "700" },
  input: {
    minHeight: 72,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.bgTint,
    padding: 12,
    fontSize: 15,
    color: colors.text,
    textAlignVertical: "top",
  },
  error: { fontSize: 14, lineHeight: 20, color: colors.accent900, fontWeight: "600" },
  primary: {
    marginTop: 12,
    alignItems: "center",
    paddingVertical: 15,
    borderRadius: radii.pill,
    backgroundColor: colors.accent600,
  },
  primaryOff: { backgroundColor: colors.captureSegOff },
  primaryText: { color: colors.white, fontSize: 16, fontWeight: "700" },
  secondary: { marginTop: 4, alignItems: "center", paddingVertical: 12 },
  secondaryText: { color: colors.textSecondary, fontSize: 15, fontWeight: "600" },
});
