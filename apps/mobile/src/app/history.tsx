import { router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { listSessions, SessionSummary } from "../api/sessions-list";
import { getClinicianToken } from "../auth/tokenStore";
import { Screen, useResponsive } from "../components/Screen";
import { colors } from "../theme/colors";

const STATE_LABEL: Record<string, string> = {
  Setup: "Setting up",
  Observing: "In progress",
  Pause: "Paused",
  ClinicianReview: "Needs review",
};

export default function HistoryScreen() {
  const { titleSize, bodySize } = useResponsive();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getClinicianToken();
        if (!token) return router.replace("/login");
        const found = await listSessions(token, 50);
        if (!cancelled) setSessions(found);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load sessions.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Screen style={styles.screen}>
      <Pressable onPress={() => router.back()} hitSlop={12}>
        <Text style={styles.back}>Back</Text>
      </Pressable>
      <Text style={[styles.title, { fontSize: titleSize - 6 }]}>All sessions</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View>
              <Text style={[styles.rowDate, { fontSize: bodySize }]}>
                {new Date(item.createdAt).toLocaleDateString()}
              </Text>
              <Text style={styles.rowProtocol}>{item.protocolId}</Text>
            </View>
            <Text style={styles.stateChip}>{STATE_LABEL[item.state] ?? item.state}</Text>
          </View>
        )}
        ListEmptyComponent={!error ? <Text style={styles.empty}>No sessions yet.</Text> : undefined}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingTop: 58 },
  back: { color: colors.textFaint, fontSize: 15, marginBottom: 12 },
  title: { color: colors.text, fontWeight: "600", marginBottom: 16 },
  error: { color: colors.caution, marginBottom: 10 },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 15, borderRadius: 16, marginBottom: 9,
    backgroundColor: colors.surfaceSolid, borderWidth: 1, borderColor: colors.hairline,
  },
  rowDate: { color: colors.text, fontWeight: "600" },
  rowProtocol: { color: colors.textMuted, fontSize: 12.5, marginTop: 2 },
  stateChip: {
    fontSize: 11, fontWeight: "600", color: colors.accent700,
    backgroundColor: colors.accent100, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7,
  },
  empty: { color: colors.textFaint, marginTop: 20 },
});
