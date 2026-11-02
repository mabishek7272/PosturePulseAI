import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { listMetricResults, MetricResult } from "../api/events";
import { getClinicianToken } from "../auth/tokenStore";

function formatResult(result: MetricResult): string {
  const unitSuffix = result.unit === "deg" ? "°" : result.unit ? ` ${result.unit}` : "";
  if (result.estimate) {
    const { value, uncertainty } = result.estimate;
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(1)} ± ${uncertainty.toFixed(1)}${unitSuffix}`;
  }
  // Never blank, never zero-filled: an unmeasurable row states its reason.
  if (result.unsupported) return `Not measured — ${result.unsupported.reasons.join(", ")}`;
  if (result.notMeasurable) return `Not measurable — ${result.notMeasurable.reason}`;
  return "No result recorded";
}

export default function ResultsScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [results, setResults] = useState<MetricResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getClinicianToken();
        if (!token) return router.replace("/login");
        const found = await listMetricResults(sessionId, token);
        if (!cancelled) setResults(found);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load results.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Measurements</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={results}
        keyExtractor={(r, i) => `${r.metricKey}-${r.side ?? ""}-${i}`}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.metric}>
              {item.metricKey}
              {item.side ? ` (${item.side})` : ""}
            </Text>
            <Text style={styles.value}>{formatResult(item)}</Text>
          </View>
        )}
        ListEmptyComponent={!error ? <Text style={styles.empty}>No measurements returned.</Text> : undefined}
      />
      <Text style={styles.caption}>
        Camera-based estimates. Not a substitute for clinical examination.
      </Text>
      <Pressable style={styles.button} onPress={() => router.replace("/home")}>
        <Text style={styles.buttonText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0e0a16", padding: 20, paddingTop: 60 },
  title: { color: "#efeaf6", fontSize: 26, fontWeight: "800", marginBottom: 16 },
  error: { color: "#ff6b6b", marginBottom: 12 },
  row: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  metric: { color: "#9d93ae", fontSize: 12 },
  value: { color: "#efeaf6", fontSize: 17, fontWeight: "600", marginTop: 3 },
  empty: { color: "#9d93ae", marginTop: 20 },
  caption: { color: "#9d93ae", fontSize: 11, marginTop: 14, textAlign: "center" },
  button: { backgroundColor: "#b98cff", borderRadius: 12, padding: 16, alignItems: "center", marginTop: 14 },
  buttonText: { color: "#0e0a16", fontWeight: "700", fontSize: 16 },
});
