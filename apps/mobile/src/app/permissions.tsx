import { router } from "expo-router";
import { useEffect } from "react";
import { Linking, Pressable, StyleSheet, Text } from "react-native";
import { useCameraPermission } from "react-native-vision-camera";
import { Screen, useResponsive } from "../components/Screen";

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
    <Screen center>
      <Text style={[styles.title, { fontSize: titleSize }]}>Camera access</Text>
      <Text style={[styles.body, { fontSize: bodySize, lineHeight: bodySize * 1.5 }]}>
        PosturePulse AI records short video clips of each assessment pose. The clips are uploaded to your
        clinic's server for measurement and are never shared elsewhere.
      </Text>
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
  title: { color: "#efeaf6", fontSize: 26, fontWeight: "800", marginBottom: 12 },
  body: { color: "#9d93ae", fontSize: 15, lineHeight: 22, marginBottom: 24 },
  denied: { color: "#ff6b6b", marginBottom: 16 },
  button: { backgroundColor: "#b98cff", borderRadius: 12, padding: 17, alignItems: "center" },
  buttonText: { color: "#0e0a16", fontWeight: "700", fontSize: 16 },
});
