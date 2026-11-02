import { router } from "expo-router";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { BottomTabBar } from "../components/BottomTabBar";
import { Screen, useResponsive } from "../components/Screen";
import { clearClinicianToken } from "../auth/tokenStore";
import { colors } from "../theme/colors";

interface ToggleRow {
  label: string;
  caption: string;
}

// Every one of these describes a feature that does not exist in the app yet
// (on-device pose guidance is P2 scope; AI-drafted assessment is P4) -
// rendered visibly disabled rather than a toggle that looks live but does
// nothing. docs/superpowers/specs/2026-11-03-posturepulse-pro-reskin-design.md Part 3.
const NOT_YET_BUILT: ToggleRow[] = [
  { label: "Auto-capture when steady", caption: "Coming soon" },
  { label: "Skeleton overlay", caption: "Coming soon" },
  { label: "Draft clinical notes", caption: "Coming soon" },
  { label: "Live capture guidance", caption: "Coming soon" },
];

export default function SettingsScreen() {
  const { titleSize, bodySize } = useResponsive();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgDeep }}>
      <Screen style={styles.screen}>
        <Text style={[styles.title, { fontSize: titleSize - 6 }]}>Settings</Text>

        <View style={styles.section}>
          {NOT_YET_BUILT.map((row) => (
            <View key={row.label} style={styles.row}>
              <View>
                <Text style={[styles.rowLabel, { fontSize: bodySize }]}>{row.label}</Text>
                <Text style={styles.rowCaption}>{row.caption}</Text>
              </View>
              <Switch value={false} disabled trackColor={{ false: colors.hairline, true: colors.accent400 }} />
            </View>
          ))}
        </View>

        <Pressable
          style={styles.signOutButton}
          onPress={async () => {
            await clearClinicianToken();
            router.replace("/login");
          }}
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>

        <Text style={styles.version}>PosturePulse AI 1.0.0</Text>
      </Screen>
      <BottomTabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { paddingTop: 58, paddingBottom: 110 },
  title: { color: colors.text, fontWeight: "600", marginBottom: 20 },
  section: {
    borderRadius: 18, backgroundColor: colors.surfaceSolid, borderWidth: 1, borderColor: colors.hairline,
    marginBottom: 24,
  },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: colors.hairline,
  },
  rowLabel: { color: colors.text, fontWeight: "600" },
  rowCaption: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  signOutButton: { padding: 16, borderRadius: 13, alignItems: "center", backgroundColor: colors.accent100 },
  signOutText: { color: colors.accent700, fontWeight: "700" },
  version: { color: colors.textFaint, fontSize: 11, textAlign: "center", marginTop: 20 },
});
