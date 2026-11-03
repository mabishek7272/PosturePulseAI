import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { router, usePathname, type Href } from "expo-router";
import { useEffect, type ComponentType } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, gradients } from "../theme/colors";
import { shadows } from "../theme/shadows";
import { CameraIcon, HomeIcon, PatientsIcon, ProfileIcon, TrendsIcon, type IconProps } from "./icons";

interface TabItem {
  key: string;
  label: string;
  route: Href;
  Icon: ComponentType<IconProps>;
}

const LEFT: TabItem[] = [
  { key: "home", label: "Home", route: "/home", Icon: HomeIcon },
  { key: "patients", label: "Patients", route: "/patient", Icon: PatientsIcon },
];
const RIGHT: TabItem[] = [
  { key: "trends", label: "Trends", route: "/trends", Icon: TrendsIcon },
  { key: "profile", label: "Profile", route: "/settings", Icon: ProfileIcon },
];

/**
 * Shared floating bottom bar. The raised centre camera button always starts a
 * new assessment (patient selection) and is never "active".
 */
export function BottomTabBar() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const ios = Platform.OS === "ios";
  return (
    <View style={[styles.bar, shadows.bar, { bottom: Math.max(14, insets.bottom) }, !ios && styles.barSolid]}>
      <View style={[StyleSheet.absoluteFill, styles.clip]}>
        {ios ? <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} /> : null}
        <View style={[StyleSheet.absoluteFill, styles.tint]} />
      </View>
      {LEFT.map((t) => <TabButton key={t.key} tab={t} active={pathname === t.route} />)}
      <CameraButton />
      {RIGHT.map((t) => <TabButton key={t.key} tab={t} active={pathname === t.route} />)}
    </View>
  );
}

function TabButton({ tab, active }: { tab: TabItem; active: boolean }) {
  const color = active ? colors.accent700 : colors.textFaint;
  return (
    <Pressable
      style={styles.tab}
      onPress={() => router.push(tab.route)}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: active }}
    >
      <tab.Icon size={21} color={color} />
      <Text style={[styles.label, { color }]}>{tab.label}</Text>
    </Pressable>
  );
}

function CameraButton() {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 3000, easing: Easing.out(Easing.ease) }), -1, false);
  }, [t]);
  // ppRing: scale .8 -> 1.65, opacity .5 -> 0 over first 70% then holds.
  const ring = useAnimatedStyle(() => {
    const k = Math.min(t.value / 0.7, 1);
    return { opacity: 0.5 * (1 - k), transform: [{ scale: 0.8 + 0.85 * k }] };
  });
  return (
    <Pressable
      onPress={() => router.push("/patient")}
      accessibilityRole="button"
      accessibilityLabel="New assessment"
      style={({ pressed }) => [shadows.fab, styles.fabWrap, pressed && { transform: [{ scale: 0.96 }] }]}
    >
      <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fab}>
        <Animated.View pointerEvents="none" style={[styles.ring, ring]} />
        <CameraIcon size={24} color={colors.accent100} />
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute", left: 14, right: 14, height: 72,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 10, borderRadius: 24, borderWidth: 1, borderColor: colors.barRing,
    overflow: "visible",
  },
  barSolid: { backgroundColor: colors.glassStrong },
  clip: { borderRadius: 23, overflow: "hidden" },
  tint: { borderRadius: 24, backgroundColor: colors.glassBar },
  tab: { width: 56, alignItems: "center", gap: 4, paddingVertical: 8 },
  label: { fontSize: 10, fontWeight: "600", letterSpacing: 0.2 },
  fabWrap: { width: 58, height: 58, borderRadius: 20 },
  fab: { width: 58, height: 58, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  ring: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 20,
    borderWidth: 1, borderColor: colors.accentRing,
  },
});
