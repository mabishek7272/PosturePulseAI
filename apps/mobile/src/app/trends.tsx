import { View, Text, StyleSheet } from "react-native";
import { BottomTabBar } from "../components/BottomTabBar";
import { Screen, useResponsive } from "../components/Screen";
import { colors } from "../theme/colors";

/**
 * No backend aggregates metric values across a patient's sessions yet, and
 * the source design's trend chart was keyed to a composite "posture index"
 * this app does not compute (docs/superpowers/specs/2026-11-03-posturepulse-pro-reskin-design.md
 * Part 3). An honest placeholder, not a fabricated chart.
 */
export default function TrendsScreen() {
  const { titleSize, bodySize } = useResponsive();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bgDeep }}>
      <Screen center style={styles.screen}>
        <Text style={[styles.title, { fontSize: titleSize - 8 }]}>Trends</Text>
        <Text style={[styles.body, { fontSize: bodySize }]}>Not available yet.</Text>
      </Screen>
      <BottomTabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { paddingBottom: 110 },
  title: { color: colors.text, fontWeight: "600", marginBottom: 8 },
  body: { color: colors.textMuted },
});
