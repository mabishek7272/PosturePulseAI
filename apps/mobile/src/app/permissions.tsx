import { router } from "expo-router";
import { useEffect, useRef, type ReactNode } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCameraPermission } from "react-native-vision-camera";
import { MotionIcon, PermCameraIcon, PermMicIcon } from "../components/authIcons";
import { PrimaryButton } from "../components/Buttons";
import { DesignSwitch } from "../components/DesignSwitch";
import { DriftingBlobs, type BlobSpec } from "../components/DriftingBlobs";
import { FadeUp } from "../components/FadeUp";
import { GlassCard } from "../components/GlassCard";
import { BackButton } from "../components/ScreenHeader";
import { CheckIcon } from "../components/icons";
import { colors } from "../theme/colors";

const BLOBS: BlobSpec[] = [{ size: 380, right: -120, top: -120, color: colors.accent200, duration: 18 }];

function PermRow({
  delay, icon, title, subtitle, right, muted = false,
}: { delay: number; icon: ReactNode; title: string; subtitle: string; right: ReactNode; muted?: boolean }) {
  return (
    <FadeUp delay={delay} duration={650}>
      <GlassCard radius={18} fill={colors.glass} ring={muted ? colors.hairline : colors.accent200} intensity={45}>
        <View style={styles.row}>
          <View style={[styles.tile, muted && styles.tileMuted]}>{icon}</View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{title}</Text>
            <Text style={styles.rowSub}>{subtitle}</Text>
          </View>
          {right}
        </View>
      </GlassCard>
    </FadeUp>
  );
}

function CheckCircle() {
  return (
    <View accessibilityLabel="Granted" style={styles.check}>
      <CheckIcon size={14} color={colors.white} strokeWidth={2.6} />
    </View>
  );
}

export default function PermissionsScreen() {
  const insets = useSafeAreaInsets();
  // vision-camera v5 exposes permissions as a reactive hook rather than the
  // static Camera.requestCameraPermission() of v4.
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();
  const requestedHere = useRef(false);

  // Already granted on arrival (returning clinician): skip straight to home.
  // If they grant it here, keep the screen so they see the check and press Continue.
  useEffect(() => {
    if (hasPermission && !requestedHere.current) router.replace("/home");
  }, [hasPermission]);

  // Permission permanently denied: requesting again is a no-op, so send the
  // clinician to Settings rather than a button that silently does nothing.
  const mustUseSettings = !hasPermission && !canRequestPermission;

  function onAllow() {
    if (mustUseSettings) {
      void Linking.openSettings();
    } else {
      requestedHere.current = true;
      void requestPermission();
    }
  }

  return (
    <View style={styles.root}>
      <DriftingBlobs blobs={BLOBS} />
      <View style={[styles.content, { paddingTop: Math.max(62, insets.top + 12), paddingBottom: Math.max(32, insets.bottom) }]}>
        <View style={styles.column}>
          <View style={{ alignSelf: "flex-start" }}>
            <BackButton variant="tint" onPress={() => router.replace("/login")} />
          </View>

          <FadeUp style={styles.heading}>
            <Text style={styles.eyebrow}>STEP 1 OF 3</Text>
            <Text accessibilityRole="header" style={styles.title}>Device access</Text>
            <Text style={styles.subtitle}>
              Capture uploads short clips to your clinic's server for measurement. Nothing is shared
              beyond your clinic.
            </Text>
          </FadeUp>

          <View style={styles.list}>
            <PermRow
              delay={80}
              icon={<PermCameraIcon color={colors.accent700} />}
              title="Camera"
              subtitle="Rear camera, for the four capture views"
              right={
                hasPermission ? (
                  <CheckCircle />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={mustUseSettings ? "Open Settings" : "Allow camera"}
                    onPress={onAllow}
                    style={({ pressed }) => [styles.allow, pressed && { backgroundColor: colors.accent700 }]}
                  >
                    <Text style={styles.allowText}>{mustUseSettings ? "Open Settings" : "Allow"}</Text>
                  </Pressable>
                )
              }
            />
            <PermRow
              delay={160}
              icon={<MotionIcon color={colors.accent700} />}
              title="Motion sensors"
              subtitle="Records which way is down for each clip"
              right={<CheckCircle />}
            />
            <PermRow
              delay={240}
              muted
              icon={<PermMicIcon color={colors.textMuted} />}
              title="Microphone"
              subtitle="Not used yet"
              right={<DesignSwitch value={false} disabled accessibilityLabel="Microphone, not used yet" />}
            />
          </View>

          {!hasPermission && mustUseSettings ? (
            <Text style={styles.denied}>Camera access was denied. Enable it in Settings to run an assessment.</Text>
          ) : null}

          <View style={{ flexGrow: 1, minHeight: 24 }} />
          <View style={styles.footer}>
            <PrimaryButton
              label="Continue"
              height={54}
              disabled={!hasPermission}
              onPress={() => router.replace("/home")}
            />
            <Text style={styles.footnote}>You can change these later in Settings</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white, overflow: "hidden" },
  content: { flex: 1, paddingHorizontal: 28 },
  column: { flex: 1, width: "100%", maxWidth: 440, alignSelf: "center" },
  heading: { marginTop: 22, gap: 10 },
  eyebrow: { fontSize: 11, fontWeight: "600", letterSpacing: 1.76, color: colors.accent600 },
  title: { fontSize: 27, fontWeight: "600", letterSpacing: -0.81, lineHeight: 31.86, color: colors.text },
  subtitle: { fontSize: 14, lineHeight: 21, color: colors.textMuted },
  list: { marginTop: 28, gap: 11 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 17, paddingHorizontal: 16 },
  tile: {
    width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.accent100, borderWidth: 1, borderColor: colors.accent300,
  },
  tileMuted: { backgroundColor: colors.bgTint, borderColor: colors.hairline },
  rowText: { flex: 1, gap: 3, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: "600", letterSpacing: -0.15, color: colors.text },
  rowSub: { fontSize: 12.5, lineHeight: 17.5, color: colors.textMuted },
  check: {
    width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.accent600,
  },
  allow: {
    height: 30, paddingHorizontal: 14, borderRadius: 15, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.accent600,
  },
  allowText: { fontSize: 13, fontWeight: "600", color: colors.white },
  denied: { marginTop: 14, fontSize: 13, color: colors.caution },
  footer: { gap: 12 },
  footnote: { textAlign: "center", fontSize: 12, color: colors.textFaint },
});
