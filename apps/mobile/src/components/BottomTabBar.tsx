import { router, usePathname } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";

interface TabItem {
  key: string;
  label: string;
  route: "/home" | "/patient" | "/trends" | "/settings";
}

const TABS: TabItem[] = [
  { key: "home", label: "Home", route: "/home" },
  { key: "patients", label: "Patients", route: "/patient" },
  { key: "trends", label: "Trends", route: "/trends" },
  { key: "profile", label: "Profile", route: "/settings" },
];

/**
 * Shared bottom chrome for Home, Patients, Trends and Settings. The raised
 * centre FAB always starts a new assessment - it does not reflect "current
 * tab" the way the 4 flat items do, matching the source design.
 */
export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <View style={styles.bar}>
      {TABS.slice(0, 2).map((tab) => (
        <TabButton key={tab.key} tab={tab} active={pathname === tab.route} />
      ))}

      <Pressable
        style={styles.fab}
        onPress={() => router.push("/patient")}
        accessibilityLabel="New assessment"
      >
        <View style={styles.fabRing} />
        <Text style={styles.fabIcon}>+</Text>
      </Pressable>

      {TABS.slice(2).map((tab) => (
        <TabButton key={tab.key} tab={tab} active={pathname === tab.route} />
      ))}
    </View>
  );
}

function TabButton({ tab, active }: { tab: TabItem; active: boolean }) {
  return (
    <Pressable style={styles.tab} onPress={() => router.push(tab.route)}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute", left: 14, right: 14, bottom: 14, height: 72,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 10, borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.72)",
    shadowColor: colors.accent900, shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    borderWidth: 1, borderColor: "rgba(210,206,253,0.9)",
  },
  tab: { width: 56, alignItems: "center", paddingVertical: 8 },
  tabLabel: { fontSize: 10, fontWeight: "600", color: colors.textFaint },
  tabLabelActive: { color: colors.accent700 },
  fab: {
    width: 58, height: 58, borderRadius: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.accent600,
    shadowColor: colors.accent700, shadowOpacity: 0.42, shadowRadius: 16, shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  fabRing: {
    position: "absolute", top: -1, left: -1, right: -1, bottom: -1, borderRadius: 20,
    borderWidth: 1, borderColor: "rgba(121,108,191,0.5)",
  },
  fabIcon: { color: colors.textOnDark, fontSize: 26, fontWeight: "300", marginTop: -2 },
});
