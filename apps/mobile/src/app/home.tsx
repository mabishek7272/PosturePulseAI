import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomTabBar } from "../components/BottomTabBar";
import { Screen, useResponsive } from "../components/Screen";
import { clearClinicianToken } from "../auth/tokenStore";
import { colors } from "../theme/colors";

export default function HomeScreen() {
  const { titleSize, bodySize } = useResponsive();

  return (
    <View style={styles.root}>
      <Screen style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>MO</Text>
          </View>
          <Text style={[styles.greeting, { fontSize: bodySize + 2 }]}>Clinician</Text>
          <Pressable
            style={styles.signOut}
            onPress={async () => {
              await clearClinicianToken();
              router.replace("/login");
            }}
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </View>

        <Pressable style={styles.heroCard} onPress={() => router.push("/patient")}>
          <Text style={styles.heroEyebrow}>START AN ASSESSMENT</Text>
          <Text style={[styles.heroTitle, { fontSize: titleSize - 8 }]}>New scan</Text>
          <View style={styles.heroButton}>
            <Text style={styles.heroButtonText}>Begin assessment →</Text>
          </View>
        </Pressable>

        <Pressable style={styles.allSessions} onPress={() => router.push("/history")}>
          <Text style={styles.allSessionsText}>All sessions</Text>
          <Text style={styles.allSessionsArrow}>→</Text>
        </Pressable>
      </Screen>
      <BottomTabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep },
  screen: { paddingTop: 58, paddingBottom: 110 },
  header: { flexDirection: "row", alignItems: "center", gap: 13, marginBottom: 20 },
  avatar: {
    width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.accent700,
  },
  avatarText: { color: colors.textOnDark, fontWeight: "600", fontSize: 14 },
  greeting: { color: colors.text, fontWeight: "600" },
  signOut: { marginLeft: "auto" },
  signOutText: { color: colors.textFaint, fontSize: 13 },
  heroCard: {
    padding: 20, borderRadius: 22, marginBottom: 14,
    backgroundColor: colors.accent900,
  },
  heroEyebrow: { color: colors.accent300, fontSize: 11, fontWeight: "600", letterSpacing: 2, marginBottom: 10 },
  heroTitle: { color: colors.textOnDark, fontWeight: "600", marginBottom: 16 },
  heroButton: {
    alignSelf: "flex-start", height: 46, paddingHorizontal: 20, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1, borderColor: "rgba(210,206,253,0.4)",
  },
  heroButtonText: { color: colors.textOnDark, fontWeight: "600", fontSize: 14 },
  allSessions: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 16, borderRadius: 16,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
  },
  allSessionsText: { color: colors.text, fontWeight: "600", fontSize: 14.5 },
  allSessionsArrow: { color: colors.accent600, fontSize: 14 },
});
