import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

/**
 * Six stages, each literally true of the server pipeline: upload, frame
 * extraction, landmark location, angle computation, quality gating, reference
 * comparison. Describing computation makes no clinical claim, and the copy
 * deliberately avoids the banned clinical-claim vocabulary (scripts/lint-claims.sh).
 */
export const STAGES = [
  "Uploading clips",
  "Extracting frames",
  "Locating body landmarks",
  "Computing joint angles",
  "Checking measurement quality",
  "Comparing with references",
];

export function AnalysisStages({ activeStage }: { activeStage: number }) {
  return (
    <View style={styles.list}>
      {STAGES.map((label, index) => (
        <Stage key={label} label={label} state={index < activeStage ? "done" : index === activeStage ? "active" : "pending"} />
      ))}
    </View>
  );
}

function Stage({ label, state }: { label: string; state: "pending" | "active" | "done" }) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: state === "active" ? 1 : state === "done" ? 0.55 : 0.3,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [state, opacity]);

  return (
    <Animated.View style={[styles.row, { opacity }]}>
      <View style={[styles.tick, state !== "pending" && styles.tickOn]}>
        <Text style={styles.tickText}>{state === "done" ? "✓" : ""}</Text>
      </View>
      <Text style={styles.label}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: 28, alignSelf: "stretch" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 7 },
  tick: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1.6,
    borderColor: "#6e3fc9", marginRight: 12, alignItems: "center", justifyContent: "center",
  },
  tickOn: { borderColor: "#39ffc4", backgroundColor: "rgba(57,255,196,0.16)" },
  tickText: { color: "#39ffc4", fontSize: 11, fontWeight: "800" },
  label: { color: "#efeaf6", fontSize: 14 },
});
