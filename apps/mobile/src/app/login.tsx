import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { login } from "../api/auth";
import { saveClinicianToken } from "../auth/tokenStore";

export default function LoginScreen() {
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
    <View style={styles.screen}>
      <Text style={styles.title}>beAIve</Text>
      <Text style={styles.subtitle}>Clinician sign in</Text>

      <TextInput
        style={styles.input}
        placeholder="Username"
        placeholderTextColor="#9d93ae"
        autoCapitalize="none"
        autoCorrect={false}
        value={username}
        onChangeText={setUsername}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#9d93ae"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.button} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#0e0a16" /> : <Text style={styles.buttonText}>Sign in</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0e0a16", padding: 28, justifyContent: "center" },
  title: { color: "#efeaf6", fontSize: 34, fontWeight: "800" },
  subtitle: { color: "#9d93ae", fontSize: 15, marginBottom: 28 },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)", color: "#efeaf6",
    borderRadius: 12, padding: 16, marginBottom: 12, fontSize: 16,
  },
  error: { color: "#ff6b6b", marginBottom: 12 },
  button: {
    backgroundColor: "#b98cff", borderRadius: 12, padding: 17,
    alignItems: "center", marginTop: 8,
  },
  buttonText: { color: "#0e0a16", fontWeight: "700", fontSize: 16 },
});
