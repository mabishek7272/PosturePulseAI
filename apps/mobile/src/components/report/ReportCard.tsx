import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, reportColors } from "../../theme/colors";
import { GlassCard } from "../GlassCard";

export function ReportCard({ title, children, tag }: { title: string; children: ReactNode; tag?: string }) {
  return (
    <GlassCard tint="dark" elevated={false} radius={20} intensity={18} fill={reportColors.card} ring={reportColors.cardRing}>
      <View style={styles.body}>
        <View style={styles.head}>
          <Text style={styles.title}>{title}</Text>
          {tag ? (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ) : null}
        </View>
        {children}
      </View>
    </GlassCard>
  );
}

export const cardText = StyleSheet.create({
  caption: { fontSize: 12.5, lineHeight: 18, color: colors.darkAccentA },
  strong: { fontSize: 13.5, lineHeight: 19, color: colors.accent100, fontWeight: "600" },
});

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12, minHeight: 300 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 11.5, fontWeight: "700", letterSpacing: 1.4, color: colors.accent300 },
  tag: { backgroundColor: reportColors.tag, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontSize: 10.5, fontWeight: "600", color: colors.accent100 },
});
