import { router } from "expo-router";
import { useEffect } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useCameraPermission } from "react-native-vision-camera";
import { Screen, useResponsive } from "../components/Screen";
import { colors } from "../theme/colors";

export default function PermissionsScreen() {
  // vision-camera v5 exposes permissions as a reactive hook rather than the
  // static Camera.requestCameraPermission() of v4.
  const { titleSize, bodySize } = useResponsive();
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();

  useEffect(() => {
    if (hasPermission) router.replace("/home");
  }, [hasPermission]);

  // Permission permanently denied: requesting again is a no-op, so send the
  // clinician to Settings rather than a button that silently does nothing.
  const mustUseSettings = !hasPermission && !canRequestPermission;

  return (
    <Screen>
      <Text style={styles.eyebrow}>DEVICE ACCESS</Text>
      <Text style={[styles.title, { fontSize: titleSize - 4 }]}>Camera access</Text>
      <Text style={[styles.body, { fontSize: bodySize, lineHeight: bodySize * 1.5 }]}>
        Capture uploads short clips to your clinic's server for measurement. Nothing is shared
        beyond your clinic.
      </Text>

      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>📷</Text>
        </View>
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>Camera</Text>
          <Text style={styles.cardSubtitle}>Rear camera, for the four capture views</Text>
        </View>
      </View>

      {mustUseSettings && (
        <Text style={styles.denied}>
          Camera access was denied. Enable it in Settings to run an assessment.
        </Text>
      )}
      <Pressable
        style={styles.button}
        onPress={() => (mustUseSettings ? Linking.openSettings() : requestPermission())}
      >
        <Text style={styles.buttonText}>{mustUseSettings ? "Open Settings" : "Allow camera"}</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 2, color: colors.accent600, marginTop: 8 },
  title: { color: colors.text, fontWeight: "600", marginTop: 10, marginBottom: 10 },
  body: { color: colors.textMuted, marginBottom: 24 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 14, padding: 17, borderRadius: 18,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accent200,
    marginBottom: 20,
  },
  iconWrap: {
    width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.accent100, borderWidth: 1, borderColor: colors.accent300,
  },
  icon: { fontSize: 18 },
  cardText: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  cardSubtitle: { fontSize: 12.5, color: colors.textMuted },
  denied: { color: colors.caution, marginBottom: 16 },
  button: {
    marginTop: "auto", height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.accent700,
  },
  buttonText: { color: colors.textOnDark, fontWeight: "600", fontSize: 15 },
});
