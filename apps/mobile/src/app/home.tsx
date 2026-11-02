import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { clearClinicianToken } from "../auth/tokenStore";

export default function HomeScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>beAIve</Text>
      <Text style={styles.subtitle}>Clinic assessment</Text>

      <Pressable style={styles.button} onPress={() => router.push("/patient")}>
        <Text style={styles.buttonText}>New scan</Text>
      </Pressable>

      <Pressable
        onPress={async () => {
          await clearClinicianToken();
          router.replace("/login");
        }}
      >
        <Text style={styles.signOut}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0e0a16", padding: 28, justifyContent: "center" },
  title: { color: "#efeaf6", fontSize: 34, fontWeight: "800" },
  subtitle: { color: "#9d93ae", fontSize: 15, marginBottom: 32 },
  button: { backgroundColor: "#b98cff", borderRadius: 12, padding: 18, alignItems: "center" },
  buttonText: { color: "#0e0a16", fontWeight: "700", fontSize: 16 },
  signOut: { color: "#9d93ae", textAlign: "center", marginTop: 28 },
});
