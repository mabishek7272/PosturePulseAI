import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import {
  MONTH_NAMES, WEEKDAY_LABELS, birthYears, formatLongDate, isFutureDate, monthGrid, parseIsoDate, shiftMonth,
  toIsoDate, todayYmd,
} from "../lib/calendar";
import { colors } from "../theme/colors";

type Props = {
  /** ISO "YYYY-MM-DD", or "" when nothing is chosen. */
  value: string;
  onChange: (iso: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
};

/**
 * A calendar for picking a date of birth: month grid with previous/next, and a
 * year list for jumping decades (a birth date is rarely near today). Future days
 * are disabled. Pure JS - no native module, so it ships over the air.
 */
export function DatePickerField({ value, onChange, label = "Date of birth", placeholder = "Select date", disabled }: Props) {
  const selected = parseIsoDate(value);
  const [open, setOpen] = useState(false);
  const [yearMode, setYearMode] = useState(false);
  const today = todayYmd();
  const [view, setView] = useState({ year: selected?.year ?? today.year - 30, month: selected?.month ?? today.month });

  const weeks = useMemo(() => monthGrid(view.year, view.month), [view.year, view.month]);
  const years = useMemo(() => birthYears(), []);
  const atLatestMonth = view.year === today.year && view.month === today.month;

  function pick(day: number) {
    const candidate = { year: view.year, month: view.month, day };
    if (isFutureDate(candidate)) return;
    onChange(toIsoDate(candidate));
    setOpen(false);
    setYearMode(false);
  }

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selected ? `${label}: ${formatLongDate(value)}. Change` : `${label}. Open calendar`}
        disabled={disabled}
        onPress={() => setOpen((o) => !o)}
        style={[styles.field, open && styles.fieldOpen]}
      >
        <Text style={selected ? styles.value : styles.placeholder}>{selected ? formatLongDate(value) : placeholder}</Text>
        <Text style={styles.chev}>{open ? "▲" : "▼"}</Text>
      </Pressable>

      {open && (
        <View style={styles.panel}>
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              onPress={() => setView((v) => shiftMonth(v.year, v.month, -1))}
              hitSlop={10}
              style={styles.nav}
            >
              <Text style={styles.navText}>‹</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${MONTH_NAMES[view.month - 1]} ${view.year}. Choose year`}
              onPress={() => setYearMode((m) => !m)}
              hitSlop={8}
            >
              <Text style={styles.title}>{MONTH_NAMES[view.month - 1]} {view.year} {yearMode ? "▲" : "▼"}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next month"
              accessibilityState={{ disabled: atLatestMonth }}
              disabled={atLatestMonth}
              onPress={() => setView((v) => shiftMonth(v.year, v.month, 1))}
              hitSlop={10}
              style={[styles.nav, atLatestMonth && styles.navOff]}
            >
              <Text style={styles.navText}>›</Text>
            </Pressable>
          </View>

          {yearMode ? (
            <FlatList
              data={years}
              keyExtractor={(y) => String(y)}
              numColumns={4}
              style={styles.years}
              initialScrollIndex={Math.max(0, years.indexOf(view.year))}
              getItemLayout={(_, index) => ({ length: 40, offset: 40 * Math.floor(index / 4), index })}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Year ${item}`}
                  onPress={() => {
                    setView((v) => ({ year: item, month: item === today.year ? Math.min(v.month, today.month) : v.month }));
                    setYearMode(false);
                  }}
                  style={[styles.year, item === view.year && styles.yearOn]}
                >
                  <Text style={[styles.yearText, item === view.year && styles.yearTextOn]}>{item}</Text>
                </Pressable>
              )}
            />
          ) : (
            <View>
              <View style={styles.weekRow}>
                {WEEKDAY_LABELS.map((w) => (
                  <Text key={w} style={styles.weekday}>{w}</Text>
                ))}
              </View>
              {weeks.map((week, wi) => (
                <View key={wi} style={styles.weekRow}>
                  {week.map((day, di) => {
                    if (day === null) return <View key={di} style={styles.cell} />;
                    const future = isFutureDate({ year: view.year, month: view.month, day });
                    const on = selected?.year === view.year && selected.month === view.month && selected.day === day;
                    return (
                      <Pressable
                        key={di}
                        accessibilityRole="button"
                        accessibilityLabel={`${day} ${MONTH_NAMES[view.month - 1]} ${view.year}`}
                        accessibilityState={{ disabled: future, selected: on }}
                        disabled={future}
                        onPress={() => pick(day)}
                        style={[styles.cell, styles.day, on && styles.dayOn]}
                      >
                        <Text style={[styles.dayText, future && styles.dayOff, on && styles.dayTextOn]}>{day}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.white,
    paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10,
  },
  fieldOpen: { borderColor: colors.accent400 },
  value: { color: colors.text, fontSize: 14 },
  placeholder: { color: colors.textFaint, fontSize: 14 },
  chev: { color: colors.textFaint, fontSize: 10 },
  panel: {
    borderRadius: 14, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.white, padding: 10, marginBottom: 10,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  nav: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgTint },
  navOff: { opacity: 0.35 },
  navText: { color: colors.accent700, fontSize: 22, lineHeight: 24, fontWeight: "600" },
  title: { color: colors.text, fontSize: 14, fontWeight: "700" },
  weekRow: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", color: colors.textFaint, fontSize: 11, fontWeight: "600", paddingVertical: 4 },
  cell: { flex: 1, aspectRatio: 1, maxHeight: 40, alignItems: "center", justifyContent: "center" },
  day: { borderRadius: 20 },
  dayOn: { backgroundColor: colors.accent700 },
  dayText: { color: colors.text, fontSize: 13 },
  dayOff: { color: colors.textDisabled },
  dayTextOn: { color: colors.white, fontWeight: "700" },
  years: { maxHeight: 200 },
  year: { flex: 1, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 10, margin: 2 },
  yearOn: { backgroundColor: colors.accent700 },
  yearText: { color: colors.text, fontSize: 13 },
  yearTextOn: { color: colors.white, fontWeight: "700" },
});
