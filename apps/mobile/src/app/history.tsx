import { View, Text, StyleSheet } from "react-native";
import { colors } from "../theme/colors";

export default function HistoryScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.text}>Coming soon.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgDeep, alignItems: "center", justifyContent: "center" },
  text: { color: colors.textMuted },
});
