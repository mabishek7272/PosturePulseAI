import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * "pills": separate bordered chips (Today/Active/Flagged/All).
   * "inset": chips inside a white rounded track (12w/6m/All).
   */
  variant?: "pills" | "inset";
}

/** Segmented selector in both of the design's styles. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  variant = "pills",
}: SegmentedControlProps<T>) {
  const inset = variant === "inset";
  return (
    <View accessibilityRole="tablist" style={inset ? styles.track : styles.row}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[
              inset ? styles.insetChip : styles.pill,
              active ? styles.active : inset ? undefined : styles.idlePill,
            ]}
          >
            <Text
              style={[
                inset ? styles.insetText : styles.pillText,
                { fontWeight: active ? "600" : "500", color: active ? colors.accent100 : inset ? colors.textMuted : colors.textSecondary },
              ]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 7 },
  pill: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 9 },
  idlePill: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline },
  pillText: { fontSize: 12 },
  track: {
    flexDirection: "row", gap: 4, padding: 4, borderRadius: 11,
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline,
  },
  insetChip: { paddingVertical: 6, paddingHorizontal: 11, borderRadius: 8 },
  insetText: { fontSize: 11.5 },
  active: { backgroundColor: colors.accent700 },
});
