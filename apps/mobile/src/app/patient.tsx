import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { Avatar } from "../components/Avatar";
import { PrimaryButton } from "../components/Buttons";
import { FadeUp } from "../components/FadeUp";
import { GlassCard } from "../components/GlassCard";
import { ChevronRightIcon, PlusIcon, SearchIcon } from "../components/icons";
import { BackButton } from "../components/ScreenHeader";
import { initialsOf, patientMeta } from "../lib/homeData";
import { effectiveQuery, patientListView, sortRecentFirst } from "../lib/patientList";
import { colors } from "../theme/colors";

/** Matches the backend's own check (patients.service.ts `dateOfBirth`). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Only "All" is backed by the API; the other filters render disabled. */
const FILTERS = [
  { label: "Today", enabled: false },
  { label: "Active", enabled: false },
  { label: "Flagged", enabled: false },
  { label: "All", enabled: true },
];

export default function PatientPickerScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const firstLoad = useRef(true);

  // Reload whenever the screen regains focus (after creating a patient, or
  // coming back from consent).
  useFocusEffect(
    useCallback(() => {
      setReloadTick((t) => t + 1);
    }, [])
  );

  // Load the register straight away; a search of 2+ characters filters it
  // (debounced). Shorter queries show everyone.
  useEffect(() => {
    let cancelled = false;
    const q = effectiveQuery(query);
    const delay = q && !firstLoad.current ? 300 : 0;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const token = await getClinicianToken();
        if (!token) return router.replace("/login");
        const found = await searchPatients(q, token);
        if (!cancelled) {
          setResults(q ? found : sortRecentFirst(found));
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load patients.");
      } finally {
        if (!cancelled) setLoading(false);
        firstLoad.current = false;
      }
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, reloadTick]);

  /** Opens the patient's profile (details, previous scans, "New scan"). */
  function choose(patient: PatientRecord) {
    router.push({ pathname: "/patient-profile", params: { patientId: patient.id } });
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

  const trimmed = query.trim();
  const view = patientListView({ loading, error, count: results.length, query });
  return (
    <View style={styles.root}>
      <View style={styles.flex}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <BackButton />
            <Text accessibilityRole="header" style={styles.h1}>Patients</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New patient"
              onPress={() => setFormOpen((v) => !v)}
              style={({ pressed }) => [styles.newPill, pressed && { backgroundColor: colors.accent200 }]}
            >
              <PlusIcon size={15} color={colors.accent700} />
              <Text style={styles.newPillText}>New</Text>
            </Pressable>
          </View>
          <View style={styles.search}>
            <SearchIcon size={17} color={colors.textFaint} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name"
              placeholderTextColor={colors.textFaint}
              autoCorrect={false}
              value={query}
              onChangeText={setQuery}
            />
          </View>
          <View style={styles.filters}>
            {FILTERS.map((f) => (
              <View
                key={f.label}
                accessibilityRole="button"
                accessibilityLabel={f.label}
                accessibilityState={{ disabled: !f.enabled, selected: f.enabled }}
                style={[styles.filter, f.enabled ? styles.filterOn : styles.filterOff, !f.enabled && styles.filterDisabled]}
              >
                <Text style={[styles.filterText, f.enabled ? styles.filterTextOn : styles.filterTextOff]}>{f.label}</Text>
              </View>
            ))}
          </View>
        </View>
        <FlatList
          data={results}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={{ height: 9 }} />}
          ListHeaderComponent={
            <View>
              {formOpen ? (
                <NewPatientForm
                  initialName={trimmed}
                  busy={creating}
                  onCreate={createAndChoose}
                  onCancel={() => setFormOpen(false)}
                />
              ) : null}
              {error && (view === "list" || formOpen) ? <Text style={styles.error}>{error}</Text> : null}
              {results.length > 0 || formOpen ? <View style={{ height: formOpen ? 9 : 0 }} /> : null}
            </View>
          }
          renderItem={({ item, index }) => (
            <FadeUp delay={index * 60} duration={600}>
              <Pressable accessibilityRole="button" accessibilityLabel={item.name} onPress={() => choose(item)}>
                {({ pressed }) => (
                  <GlassCard fill={pressed ? colors.accent100 : colors.glassStrong} radius={18} elevated={false} intensity={30}>
                    <View style={styles.row}>
                      <Avatar initials={initialsOf(item.name)} size={46} radius={14} variant="soft" />
                      <View style={styles.rowText}>
                        <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.rowMeta}>{patientMeta(item.dateOfBirth, new Date())}</Text>
                      </View>
                      <View style={styles.rowChevron}>
                        <ChevronRightIcon size={16} color={colors.textFaint} />
                      </View>
                    </View>
                  </GlassCard>
                )}
              </Pressable>
            </FadeUp>
          )}
          ListEmptyComponent={
            formOpen ? undefined : view === "loading" ? (
              <View style={styles.emptyBox}><ActivityIndicator color={colors.accent600} /></View>
            ) : view === "error" ? (
              <View style={styles.emptyBox}>
                <Text style={styles.error}>{error}</Text>
                <Pressable accessibilityRole="button" onPress={() => setReloadTick((t) => t + 1)} style={styles.retry}>
                  <Text style={styles.retryText}>Retry</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={styles.empty}>
                {view === "noMatches" ? "No matching patient." : "No patients yet — tap + New."}
              </Text>
            )
          }
        />
      </View>
      <BottomTabBar />
    </View>
  );
}

function NewPatientForm({
  initialName,
  busy,
  onCreate,
  onCancel,
}: {
  initialName: string;
  busy: boolean;
  onCreate: (name: string, dateOfBirth: string, intake: PatientIntake | undefined) => void;
  onCancel: () => void;
}) {
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
    <GlassCard fill={colors.glassStrong} radius={18} intensity={30}>
    <View style={styles.formWrap}>
      <Text style={styles.formTitle}>New patient</Text>
      <TextInput
        style={styles.input}
        placeholder="Full name"
        placeholderTextColor={colors.textFaint}
        value={name}
        onChangeText={setName}
      />
      <TextInput
        style={styles.input}
        placeholder="Date of birth (YYYY-MM-DD)"
        placeholderTextColor={colors.textFaint}
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
              style={[styles.input, styles.half]}
              placeholder="Height (cm)"
              placeholderTextColor={colors.textFaint}
              keyboardType="decimal-pad"
              value={heightCm}
              onChangeText={setHeightCm}
            />
            <TextInput
              style={[styles.input, styles.half]}
              placeholder="Weight (kg)"
              placeholderTextColor={colors.textFaint}
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
            style={[styles.input, styles.note]}
            placeholder="E.g. lower back pain for two weeks"
            placeholderTextColor={colors.textFaint}
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
              style={[styles.input, styles.note]}
              placeholder="Details (optional)"
              placeholderTextColor={colors.textFaint}
              multiline
              value={accidentDetails}
              onChangeText={setAccidentDetails}
            />
          )}
        </View>
      )}

      {localError && <Text style={styles.error}>{localError}</Text>}
      <PrimaryButton label="Create and select" onPress={submit} loading={busy} />
      <Pressable onPress={onCancel} disabled={busy}>
        <Text style={styles.cancel}>Cancel</Text>
      </Pressable>
    </View>
    </GlassCard>
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
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    paddingTop: 58, paddingHorizontal: 22, paddingBottom: 16, gap: 14,
    backgroundColor: colors.glassHeader, borderBottomWidth: 1, borderBottomColor: colors.hairline,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  h1: { fontSize: 21, fontWeight: "600", letterSpacing: -0.525, color: colors.text },
  newPill: {
    marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 7, height: 40, paddingHorizontal: 15,
    borderRadius: 12, backgroundColor: colors.accent100, borderWidth: 1, borderColor: colors.accent300,
  },
  newPillText: { fontSize: 13, fontWeight: "600", color: colors.accent700 },
  search: {
    flexDirection: "row", alignItems: "center", gap: 10, height: 46, paddingHorizontal: 14, borderRadius: 13,
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline,
  },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.text, padding: 0 },
  filters: { flexDirection: "row", gap: 7 },
  filter: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 9 },
  filterOn: { backgroundColor: colors.accent700 },
  filterOff: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline },
  filterDisabled: { opacity: 0.5 },
  filterText: { fontSize: 12 },
  filterTextOn: { fontWeight: "600", color: colors.accent100 },
  filterTextOff: { fontWeight: "500", color: colors.textSecondary },
  list: { paddingTop: 16, paddingHorizontal: 22, paddingBottom: 110 },

  row: { flexDirection: "row", alignItems: "center", gap: 13, padding: 15 },
  rowText: { gap: 3, flexShrink: 1 },
  rowName: { fontSize: 15.5, fontWeight: "600", letterSpacing: -0.23, color: colors.text },
  rowMeta: { fontSize: 12.5, color: colors.textMuted },
  rowChevron: { marginLeft: "auto" },
  empty: { color: colors.textFaint, fontSize: 13 },
  emptyBox: { alignItems: "center", gap: 10, paddingTop: 24 },
  retry: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 10, backgroundColor: colors.accent100, borderWidth: 1, borderColor: colors.accent300 },
  retryText: { color: colors.accent700, fontWeight: "600", fontSize: 13 },
  error: { color: colors.caution, marginBottom: 10 },

  input: {
    backgroundColor: colors.white, color: colors.text, fontSize: 14.5,
    borderRadius: 13, paddingHorizontal: 14, paddingVertical: 13,
    borderWidth: 1, borderColor: colors.hairline, marginBottom: 12,
  },
  formWrap: { padding: 16 },
  formTitle: { color: colors.text, fontSize: 16, fontWeight: "600", letterSpacing: -0.2, marginBottom: 12 },
  cancel: { color: colors.textFaint, textAlign: "center", marginTop: 14, fontSize: 13 },

  intakeToggle: { paddingVertical: 10 },
  intakeToggleText: { color: colors.accent600, fontSize: 13, fontWeight: "600" },
  intakeSection: { borderTopWidth: 1, borderTopColor: colors.hairline, marginTop: 4, marginBottom: 14, paddingTop: 14 },
  intakeLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "600", letterSpacing: 1.32, marginBottom: 10 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "600", marginBottom: 8, marginTop: 2 },
  row2: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  note: { minHeight: 60, textAlignVertical: "top" },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 12 },
  chip: {
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline, borderRadius: 9,
    paddingVertical: 7, paddingHorizontal: 13,
  },
  chipOn: { backgroundColor: colors.accent700, borderColor: colors.accent700 },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "500" },
  chipTextOn: { color: colors.accent100, fontWeight: "600" },

  checkboxRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.hairlineStrong,
    marginRight: 10, alignItems: "center", justifyContent: "center",
  },
  checkboxOn: { backgroundColor: colors.accent600, borderColor: colors.accent600 },
  checkboxMark: { color: colors.textOnDark, fontSize: 13, fontWeight: "800" },
});
