import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { createPatient, PatientRecord, searchPatients } from "../api/patients";
import { getClinicianToken } from "../auth/tokenStore";
import { Screen, useResponsive } from "../components/Screen";

/** Matches the backend's own check (patients.service.ts `dateOfBirth`). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function PatientPickerScreen() {
  const { titleSize, bodySize } = useResponsive();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setError(null);
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

  function choose(patient: PatientRecord) {
    router.push({ pathname: "/consent", params: { patientId: patient.id, patientName: patient.name } });
  }

  async function createAndChoose(name: string, dateOfBirth: string) {
    setCreating(true);
    setError(null);
    try {
      const token = await getClinicianToken();
      if (!token) return router.replace("/login");
      const patient = await createPatient({ name, dateOfBirth }, token);
      choose(patient);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the patient.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Screen style={styles.screen}>
      <Pressable onPress={() => router.back()} hitSlop={12}>
        <Text style={styles.back}>Back</Text>
      </Pressable>
      <Text style={[styles.title, { fontSize: titleSize }]}>Who are you assessing?</Text>
      <TextInput
        style={[styles.input, { fontSize: bodySize + 1 }]}
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
          <Pressable style={styles.row} onPress={() => choose(item)}>
            <Text style={[styles.rowName, { fontSize: bodySize + 2 }]}>{item.name}</Text>
            <Text style={styles.rowMeta}>{item.dateOfBirth}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          query.trim().length >= 2 ? <Text style={styles.empty}>No matching patient.</Text> : undefined
        }
        ListFooterComponent={
          <NewPatientForm initialName={query.trim()} busy={creating} onCreate={createAndChoose} />
        }
      />
    </Screen>
  );
}

function NewPatientForm({
  initialName,
  busy,
  onCreate,
}: {
  initialName: string;
  busy: boolean;
  onCreate: (name: string, dateOfBirth: string) => void;
}) {
  const { bodySize, gutter } = useResponsive();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [dob, setDob] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  if (!open) {
    return (
      <Pressable style={styles.newButton} onPress={() => { setName(initialName); setOpen(true); }}>
        <Text style={styles.newButtonText}>+ New patient</Text>
      </Pressable>
    );
  }

  function submit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setLocalError("Name is required.");
      return;
    }
    // Checked client-side so the clinician sees the problem immediately; the
    // server enforces the same rule and is the final authority on it.
    if (!ISO_DATE.test(dob)) {
      setLocalError("Date of birth must be in YYYY-MM-DD format.");
      return;
    }
    setLocalError(null);
    onCreate(trimmedName, dob);
  }

  return (
    <View style={[styles.formWrap, { paddingHorizontal: gutter }]}>
      <Text style={styles.formTitle}>New patient</Text>
      <TextInput
        style={[styles.input, { fontSize: bodySize + 1 }]}
        placeholder="Full name"
        placeholderTextColor="#9d93ae"
        value={name}
        onChangeText={setName}
      />
      <TextInput
        style={[styles.input, { fontSize: bodySize + 1 }]}
        placeholder="Date of birth (YYYY-MM-DD)"
        placeholderTextColor="#9d93ae"
        keyboardType="numbers-and-punctuation"
        value={dob}
        onChangeText={setDob}
      />
      {localError && <Text style={styles.error}>{localError}</Text>}
      <Pressable style={styles.button} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#0e0a16" /> : <Text style={styles.buttonText}>Create and select</Text>}
      </Pressable>
      <Pressable onPress={() => setOpen(false)} disabled={busy}>
        <Text style={styles.cancel}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { color: "#9d93ae", fontSize: 15, marginBottom: 12 },
  screen: { paddingTop: 60 },
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
  newButton: {
    borderWidth: 1, borderColor: "#6e3fc9", borderRadius: 12,
    padding: 15, alignItems: "center", marginTop: 18,
  },
  newButtonText: { color: "#b98cff", fontWeight: "700", fontSize: 15 },
  // A plain View, not <Screen>: this renders inside a FlatList footer, which
  // isn't a flex container - Screen's flex:1 column would collapse to zero
  // height here.
  formWrap: { paddingTop: 18 },
  formTitle: { color: "#efeaf6", fontSize: 18, fontWeight: "700", marginBottom: 12 },
  button: { backgroundColor: "#b98cff", borderRadius: 12, padding: 16, alignItems: "center", marginTop: 4 },
  buttonText: { color: "#0e0a16", fontWeight: "700", fontSize: 16 },
  cancel: { color: "#9d93ae", textAlign: "center", marginTop: 14 },
});
