import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  Alcohol,
  createPatient,
  PatientIntake,
  PatientRecord,
  PhysicalActivityLevel,
  searchPatients,
  Smoking,
} from "../api/patients";
import { getClinicianToken } from "../auth/tokenStore";
import { BottomTabBar } from "../components/BottomTabBar";
import { Screen, useResponsive } from "../components/Screen";
import { colors } from "../theme/colors";

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

  async function createAndChoose(name: string, dateOfBirth: string, intake: PatientIntake | undefined) {
    setCreating(true);
    setError(null);
    try {
      const token = await getClinicianToken();
      if (!token) return router.replace("/login");
      const patient = await createPatient({ name, dateOfBirth, intake }, token);
      choose(patient);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the patient.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgDeep }}>
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
              <View style={styles.rowAvatar}>
                <Text style={styles.rowAvatarText}>
                  {item.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
                </Text>
              </View>
              <View>
                <Text style={[styles.rowName, { fontSize: bodySize + 2 }]}>{item.name}</Text>
                <Text style={styles.rowMeta}>{item.dateOfBirth}</Text>
              </View>
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
      <BottomTabBar />
    </View>
  );
}

function NewPatientForm({
  initialName,
  busy,
  onCreate,
}: {
  initialName: string;
  busy: boolean;
  onCreate: (name: string, dateOfBirth: string, intake: PatientIntake | undefined) => void;
}) {
  const { bodySize, gutter } = useResponsive();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [dob, setDob] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  // Clinical intake - every field optional, documentary context only. Shown
  // as part of the same form rather than a separate step, since it is asked
  // once at patient creation, not re-asked per visit.
  const [showIntake, setShowIntake] = useState(false);
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [smoking, setSmoking] = useState<Smoking | undefined>();
  const [alcohol, setAlcohol] = useState<Alcohol | undefined>();
  const [activity, setActivity] = useState<PhysicalActivityLevel | undefined>();
  const [physicalProblems, setPhysicalProblems] = useState("");
  const [recentAccident, setRecentAccident] = useState(false);
  const [accidentDetails, setAccidentDetails] = useState("");

  if (!open) {
    return (
      <Pressable style={styles.newButton} onPress={() => { setName(initialName); setOpen(true); }}>
        <Text style={styles.newButtonText}>+ New patient</Text>
      </Pressable>
    );
  }

  function buildIntake(): PatientIntake | undefined {
    const intake: PatientIntake = {};
    const height = Number(heightCm);
    const weight = Number(weightKg);
    if (heightCm.trim() && Number.isFinite(height)) intake.heightCm = height;
    if (weightKg.trim() && Number.isFinite(weight)) intake.weightKg = weight;
    if (smoking) intake.smoking = smoking;
    if (alcohol) intake.alcohol = alcohol;
    if (activity) intake.physicalActivityLevel = activity;
    if (physicalProblems.trim()) intake.physicalProblems = physicalProblems.trim();
    if (recentAccident) {
      intake.recentAccident = true;
      if (accidentDetails.trim()) intake.recentAccidentDetails = accidentDetails.trim();
    }
    return Object.keys(intake).length > 0 ? intake : undefined;
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
    onCreate(trimmedName, dob, buildIntake());
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

      {!showIntake ? (
        <Pressable onPress={() => setShowIntake(true)} hitSlop={8} style={styles.intakeToggle}>
          <Text style={styles.intakeToggleText}>+ Add clinical intake (optional)</Text>
        </Pressable>
      ) : (
        <View style={styles.intakeSection}>
          <Text style={styles.intakeLabel}>Clinical intake (optional)</Text>

          <View style={styles.row2}>
            <TextInput
              style={[styles.input, styles.half, { fontSize: bodySize + 1 }]}
              placeholder="Height (cm)"
              placeholderTextColor="#9d93ae"
              keyboardType="decimal-pad"
              value={heightCm}
              onChangeText={setHeightCm}
            />
            <TextInput
              style={[styles.input, styles.half, { fontSize: bodySize + 1 }]}
              placeholder="Weight (kg)"
              placeholderTextColor="#9d93ae"
              keyboardType="decimal-pad"
              value={weightKg}
              onChangeText={setWeightKg}
            />
          </View>

          <Text style={styles.fieldLabel}>Smoking</Text>
          <ChipRow<Smoking>
            options={[
              { value: "never", label: "Never" },
              { value: "former", label: "Former" },
              { value: "current", label: "Current" },
            ]}
            value={smoking}
            onChange={setSmoking}
          />

          <Text style={styles.fieldLabel}>Alcohol</Text>
          <ChipRow<Alcohol>
            options={[
              { value: "never", label: "Never" },
              { value: "occasional", label: "Occasional" },
              { value: "regular", label: "Regular" },
            ]}
            value={alcohol}
            onChange={setAlcohol}
          />

          <Text style={styles.fieldLabel}>Physical activity</Text>
          <ChipRow<PhysicalActivityLevel>
            options={[
              { value: "sedentary", label: "Sedentary" },
              { value: "light", label: "Light" },
              { value: "moderate", label: "Moderate" },
              { value: "active", label: "Active" },
            ]}
            value={activity}
            onChange={setActivity}
          />

          <Text style={styles.fieldLabel}>Any physical problem</Text>
          <TextInput
            style={[styles.input, styles.note, { fontSize: bodySize }]}
            placeholder="E.g. lower back pain for two weeks"
            placeholderTextColor="#9d93ae"
            multiline
            value={physicalProblems}
            onChangeText={setPhysicalProblems}
          />

          <Pressable
            style={styles.checkboxRow}
            onPress={() => setRecentAccident((v) => !v)}
            hitSlop={8}
          >
            <View style={[styles.checkbox, recentAccident && styles.checkboxOn]}>
              {recentAccident && <Text style={styles.checkboxMark}>✓</Text>}
            </View>
            <Text style={styles.fieldLabel}>Recently met with an accident</Text>
          </Pressable>
          {recentAccident && (
            <TextInput
              style={[styles.input, styles.note, { fontSize: bodySize }]}
              placeholder="Details (optional)"
              placeholderTextColor="#9d93ae"
              multiline
              value={accidentDetails}
              onChangeText={setAccidentDetails}
            />
          )}
        </View>
      )}

      {localError && <Text style={styles.error}>{localError}</Text>}
      <Pressable style={styles.button} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.textOnDark} /> : <Text style={styles.buttonText}>Create and select</Text>}
      </Pressable>
      <Pressable onPress={() => setOpen(false)} disabled={busy}>
        <Text style={styles.cancel}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function ChipRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T | undefined;
  onChange: (value: T | undefined) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            style={[styles.chip, selected && styles.chipOn]}
            onPress={() => onChange(selected ? undefined : opt.value)}
          >
            <Text style={[styles.chipText, selected && styles.chipTextOn]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  back: { color: colors.textFaint, fontSize: 15, marginBottom: 12 },
  screen: { paddingTop: 58, paddingBottom: 110 },
  title: { color: colors.text, fontWeight: "600", marginBottom: 16 },
  input: {
    backgroundColor: colors.surfaceSolid, color: colors.text,
    borderRadius: 13, padding: 15,
    borderWidth: 1, borderColor: colors.hairline,
    marginBottom: 14,
  },
  error: { color: colors.caution, marginBottom: 10 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 13, padding: 15, borderRadius: 18,
    backgroundColor: colors.surfaceSolid, borderWidth: 1, borderColor: colors.hairline,
    marginBottom: 9,
  },
  rowAvatar: {
    width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.accent200,
  },
  rowAvatarText: { color: colors.accent700, fontWeight: "600", fontSize: 13 },
  rowName: { color: colors.text, fontWeight: "600" },
  rowMeta: { color: colors.textMuted, fontSize: 12.5, marginTop: 2 },
  empty: { color: colors.textFaint, marginTop: 20 },
  newButton: {
    borderWidth: 1, borderColor: colors.accent600, borderRadius: 13,
    padding: 15, alignItems: "center", marginTop: 18,
  },
  newButtonText: { color: colors.accent700, fontWeight: "700", fontSize: 15 },
  // A plain View, not <Screen>: this renders inside a FlatList footer, which
  // isn't a flex container - Screen's flex:1 column would collapse to zero
  // height here.
  formWrap: { paddingTop: 18, paddingBottom: 40 },
  formTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 12 },
  button: { backgroundColor: colors.accent700, borderRadius: 13, padding: 16, alignItems: "center", marginTop: 4 },
  buttonText: { color: colors.textOnDark, fontWeight: "700", fontSize: 16 },
  cancel: { color: colors.textFaint, textAlign: "center", marginTop: 14 },

  intakeToggle: { paddingVertical: 10 },
  intakeToggleText: { color: colors.accent600, fontSize: 14, fontWeight: "600" },
  intakeSection: {
    borderTopWidth: 1, borderTopColor: colors.hairline,
    marginTop: 4, marginBottom: 14, paddingTop: 14,
  },
  intakeLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "700", letterSpacing: 0.5, marginBottom: 10 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "600", marginBottom: 8, marginTop: 2 },
  row2: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  note: { minHeight: 60, textAlignVertical: "top" },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: {
    borderWidth: 1, borderColor: colors.hairline, borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 14,
  },
  chipOn: { backgroundColor: colors.accent600, borderColor: colors.accent600 },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  chipTextOn: { color: colors.textOnDark },

  checkboxRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.hairlineStrong,
    marginRight: 10, alignItems: "center", justifyContent: "center",
  },
  checkboxOn: { backgroundColor: colors.accent600, borderColor: colors.accent600 },
  checkboxMark: { color: colors.textOnDark, fontSize: 13, fontWeight: "800" },
});
