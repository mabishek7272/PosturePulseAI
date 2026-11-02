import { router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { PatientRecord, searchPatients } from "../api/patients";
import { getClinicianToken } from "../auth/tokenStore";

export default function PatientPickerScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const token = await getClinicianToken();
        if (!token) return router.replace("/login");
        const found = await searchPatients(query.trim(), token);
        if (!cancelled) {
          setResults(found);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Search failed.");
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Who are you assessing?</Text>
      <TextInput
        style={styles.input}
        placeholder="Search by name"
        placeholderTextColor="#9d93ae"
        autoFocus
        value={query}
        onChangeText={setQuery}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={results}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() =>
              router.push({ pathname: "/consent", params: { patientId: item.id, patientName: item.name } })
            }
          >
            <Text style={styles.rowName}>{item.name}</Text>
            <Text style={styles.rowMeta}>{item.dateOfBirth}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          query.trim().length >= 2 ? <Text style={styles.empty}>No matching patient.</Text> : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0e0a16", padding: 20, paddingTop: 60 },
  title: { color: "#efeaf6", fontSize: 24, fontWeight: "800", marginBottom: 16 },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)", color: "#efeaf6",
    borderRadius: 12, padding: 15, fontSize: 16, marginBottom: 14,
  },
  error: { color: "#ff6b6b", marginBottom: 10 },
  row: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  rowName: { color: "#efeaf6", fontSize: 17, fontWeight: "600" },
  rowMeta: { color: "#9d93ae", fontSize: 13, marginTop: 2 },
  empty: { color: "#9d93ae", marginTop: 20 },
});
