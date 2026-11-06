import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { login } from "../api/auth";
import { saveClinicianToken } from "../auth/tokenStore";
import { BadgeShieldIcon, FieldLockIcon, FieldMailIcon, InfoCircleIcon } from "../components/authIcons";
import { PrimaryButton, SecondaryButton } from "../components/Buttons";
import { DriftingBlobs, type BlobSpec } from "../components/DriftingBlobs";
import { FadeUp } from "../components/FadeUp";
import { GlassCard } from "../components/GlassCard";
import { AnimatedEmblem } from "../components/AnimatedEmblem";
import { colors } from "../theme/colors";
import { shadows } from "../theme/shadows";

const BLOBS: BlobSpec[] = [
  { size: 420, left: -130, top: -150, color: colors.accent300, duration: 16 },
  { size: 300, right: -90, bottom: -60, color: colors.accent200, duration: 19, variant: 2 },
];

function Field({
  label, icon, focused, children,
}: { label: string; icon: (color: string) => React.ReactNode; focused: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View>
        <FocusGlow on={focused} />
        <View style={[styles.input, focused && styles.inputFocused]}>
          {icon(focused ? colors.accent600 : colors.textFaint)}
          {children}
        </View>
      </View>
    </View>
  );
}

/** Soft halo that fades and grows in on focus instead of snapping on. */
function FocusGlow({ on }: { on: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(on ? 1 : 0, { duration: 220 });
  }, [on, t]);
  const style = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ scale: 0.97 + 0.03 * t.value }] }));
  return <Animated.View pointerEvents="none" style={[styles.glow, style]} />;
}

/** A short horizontal shake for a failed sign-in (skipped under Reduce Motion). */
function useShake() {
  const reduce = useReducedMotion();
  const x = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const shake = () => {
    if (reduce) return;
    // `.set()` rather than `.value =`: the React Compiler treats a hook's
    // return value as immutable, and Reanimated 4's setter is the sanctioned form.
    x.set(withSequence(
      withTiming(-9, { duration: 50 }),
      withTiming(9, { duration: 70 }),
      withTiming(-6, { duration: 60 }),
      withTiming(6, { duration: 60 }),
      withTiming(0, { duration: 50 }),
    ));
  };
  return { style, shake };
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [focus, setFocus] = useState<"user" | "pass" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const card = useShake();

  async function submit() {
    if (busy || !username || !password) return;
    setBusy(true);
    setError(null);
    try {
      await saveClinicianToken(await login(username, password));
      router.replace("/permissions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      card.shake();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <DriftingBlobs blobs={BLOBS} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: Math.max(72, insets.top + 16), paddingBottom: Math.max(32, insets.bottom) },
          ]}
        >
          <View style={styles.column}>
            <FadeUp style={styles.heading}>
              <AnimatedEmblem width={64} delay={80} float glowColor={colors.accent200} style={styles.emblem} />
              <Text accessibilityRole="header" style={styles.title}>Clinician{"\n"}sign-in</Text>
              <Text style={styles.subtitle}>Shared clinic device. Sessions lock after 10 minutes idle.</Text>
            </FadeUp>

            <FadeUp delay={180} distance={28} duration={800} style={{ marginTop: 34 }}>
              <Animated.View style={card.style}>
              <GlassCard radius={20} fill={colors.glass} ring={colors.hairline} intensity={50} style={styles.cardShadow}>
                <View style={styles.cardBody}>
                  <Field label="Username" focused={focus === "user"} icon={(c) => <FieldMailIcon color={c} />}>
                    <TextInput
                      style={styles.text}
                      placeholder="Username"
                      placeholderTextColor={colors.textFaint}
                      selectionColor={colors.accent600}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="next"
                      value={username}
                      onChangeText={setUsername}
                      onFocus={() => setFocus("user")}
                      onBlur={() => setFocus((f) => (f === "user" ? null : f))}
                      onSubmitEditing={() => passRef.current?.focus()}
                    />
                  </Field>
                  <Field label="Passcode" focused={focus === "pass"} icon={(c) => <FieldLockIcon color={c} />}>
                    <TextInput
                      ref={passRef}
                      style={[styles.text, password ? styles.textSecret : null]}
                      placeholder="Passcode"
                      placeholderTextColor={colors.textFaint}
                      selectionColor={colors.accent600}
                      secureTextEntry
                      value={password}
                      onChangeText={setPassword}
                      onFocus={() => setFocus("pass")}
                      onBlur={() => setFocus((f) => (f === "pass" ? null : f))}
                      onSubmitEditing={submit}
                    />
                  </Field>

                  {error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}

                  <PrimaryButton
                    label="Unlock"
                    height={52}
                    radius={13}
                    sheen
                    loading={busy}
                    onPress={submit}
                    style={{ marginTop: 6 }}
                  />
                </View>
              </GlassCard>
              </Animated.View>
            </FadeUp>

            <FadeUp delay={320} style={{ marginTop: 14 }}>
              {/* Not built yet: rendered as designed, visibly disabled, no action. */}
              <SecondaryButton
                label="Sign in with clinic badge"
                disabled
                icon={<BadgeShieldIcon color={colors.accent700} />}
              />
            </FadeUp>

            <View style={{ flexGrow: 1, minHeight: 24 }} />
            <GlassCard radius={14} fill={colors.glassFooter} ring={colors.accent200} intensity={25} elevated={false}>
              <View style={styles.footer}>
                <InfoCircleIcon color={colors.accent600} />
                <Text style={styles.footerText}>
                  All assessments are logged against your practitioner ID and are auditable.
                </Text>
              </View>
            </GlassCard>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white, overflow: "hidden" },
  scroll: { flexGrow: 1, paddingHorizontal: 28 },
  column: { flexGrow: 1, width: "100%", maxWidth: 440, alignSelf: "center" },
  heading: { gap: 11 },
  emblem: { alignSelf: "flex-start", marginBottom: 4 },
  title: { fontSize: 29, fontWeight: "600", letterSpacing: -1.015, lineHeight: 33.35, color: colors.text },
  subtitle: { fontSize: 14, lineHeight: 21, color: colors.textMuted },
  cardShadow: { ...shadows.card, shadowOpacity: 0.07, shadowRadius: 17, shadowOffset: { width: 0, height: 14 } },
  cardBody: { gap: 14, paddingVertical: 22, paddingHorizontal: 20 },
  field: { gap: 7 },
  label: { fontSize: 12, fontWeight: "500", letterSpacing: 0.24, color: colors.textSecondary },
  input: {
    flexDirection: "row", alignItems: "center", gap: 10, height: 48, paddingHorizontal: 14,
    borderRadius: 12, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.hairline,
  },
  inputFocused: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.accent400 },
  glow: {
    position: "absolute", top: -4, left: -4, right: -4, bottom: -4, borderRadius: 16, backgroundColor: colors.focusGlow,
  },
  text: { flex: 1, fontSize: 15, color: colors.text, padding: 0 },
  textSecret: { fontSize: 17, letterSpacing: 5.1 },
  error: { fontSize: 13, color: colors.caution },
  footer: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13, paddingHorizontal: 15 },
  footerText: { flex: 1, fontSize: 12, lineHeight: 17.4, color: colors.textSecondary },
});
