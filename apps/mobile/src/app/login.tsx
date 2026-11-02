import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { login } from "../api/auth";
import { saveClinicianToken } from "../auth/tokenStore";
import { Screen, useResponsive } from "../components/Screen";
import { colors } from "../theme/colors";

export default function LoginScreen() {
  const { titleSize, bodySize } = useResponsive();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy || !username || !password) return;
    setBusy(true);
    setError(null);
    try {
      await saveClinicianToken(await login(username, password));
      router.replace("/permissions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen center>
      <View style={styles.heading}>
        <Image
          source={require("../../assets/brand/mark.png")}
          style={styles.mark}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <Text style={[styles.title, { fontSize: titleSize }]}>Clinician{"\n"}sign-in</Text>
        <Text style={[styles.subtitle, { fontSize: bodySize }]}>
          Shared clinic device. Sign out when you are done with a patient.
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.field}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={[styles.input, { fontSize: bodySize + 1 }]}
            placeholder="Username"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={[styles.input, { fontSize: bodySize + 1 }]}
            placeholder="Password"
            placeholderTextColor={colors.textFaint}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
          />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={styles.button} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color={colors.textOnDark} /> : <Text style={styles.buttonText}>Unlock</Text>}
        </Pressable>
      </View>

      <View style={styles.footnote}>
        <Text style={styles.footnoteText}>
          All assessments are logged against your practitioner ID and are auditable.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 11, marginBottom: 34 },
  mark: { width: 44, height: 44, marginBottom: 4 },
  title: { color: colors.text, fontWeight: "600", letterSpacing: -0.035 * 29, lineHeight: 34 },
  subtitle: { color: colors.textMuted, lineHeight: 21 },
  card: {
    gap: 14, padding: 20, borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.hairline,
  },
  field: { gap: 7 },
  label: { fontSize: 12, fontWeight: "500", color: "#595d6c" },
  input: {
    backgroundColor: colors.accent100, color: colors.text,
    borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: colors.hairline,
  },
  error: { color: colors.caution },
  button: {
    marginTop: 2, height: 52, borderRadius: 13, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.accent700,
  },
  buttonText: { color: colors.textOnDark, fontWeight: "600", fontSize: 15 },
  footnote: {
    marginTop: "auto", flexDirection: "row", gap: 10, padding: 13, borderRadius: 14,
    backgroundColor: "rgba(245,244,255,0.8)",
    borderWidth: 1, borderColor: colors.accent200,
  },
  footnoteText: { fontSize: 12, color: "#595d6c", lineHeight: 17, flex: 1 },
});
