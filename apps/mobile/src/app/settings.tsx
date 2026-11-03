import Constants from "expo-constants";
import { router } from "expo-router";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { clearClinicianToken, getClinicianToken } from "../auth/tokenStore";
import { Avatar } from "../components/Avatar";
import { BottomTabBar } from "../components/BottomTabBar";
import { DesignSwitch } from "../components/DesignSwitch";
import { DriftingBlobs, type BlobSpec } from "../components/DriftingBlobs";
import { FadeUp } from "../components/FadeUp";
import { GlassCard } from "../components/GlassCard";
import { ChevronRightIcon, type IconProps } from "../components/icons";
import {
  AutoCaptureIcon, GuidanceIcon, LockDeviceIcon, OverlayIcon, PrivacyIcon, SparkleSingleIcon, VoiceIcon,
} from "../components/profileIcons";
import { initialsOf, usernameFromToken } from "../lib/homeData";
import { useCaptureGuidancePref, useSkeletonOverlayPref } from "../settings/prefs";
import { colors } from "../theme/colors";
import { shadows } from "../theme/shadows";
import { type } from "../theme/typography";

const BLOBS: BlobSpec[] = [{ size: 330, right: -80, top: -100, color: colors.accent200, duration: 19 }];

type Tone = "plain" | "lavender";

/** Sign out on this device: clears the stored token and returns to login. */
async function lockDevice() {
  await clearClinicianToken();
  router.replace("/login");
}

export default function SettingsScreen() {
  const [username, setUsername] = useState<string | null>(null);
  const [skeleton, setSkeleton] = useSkeletonOverlayPref();
  const [guidance, setGuidance] = useCaptureGuidancePref();

  useEffect(() => {
    let cancelled = false;
    getClinicianToken().then((t) => {
      if (!cancelled) setUsername(usernameFromToken(t));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const name = username ?? "Clinician";
  const version = Constants.expoConfig?.version ?? "dev";

  return (
    <View style={styles.root}>
      <DriftingBlobs blobs={BLOBS} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <FadeUp>
          <Text accessibilityRole="header" style={type.title}>Profile</Text>
        </FadeUp>

        <FadeUp delay={60}>
          <GlassCard fill={colors.glassCard} ring={colors.hairline} radius={20} style={styles.cardShadow}>
            <View style={styles.userRow}>
              <Avatar initials={initialsOf(name)} size={52} variant="solid" radius={16} />
              <View style={styles.userText}>
                <Text style={styles.userName} numberOfLines={1}>{name}</Text>
                <Text style={styles.userMeta}>Signed in on this device</Text>
              </View>
            </View>
          </GlassCard>
        </FadeUp>

        <Text style={styles.section}>CAPTURE</Text>
        <Group>
          <Row Icon={AutoCaptureIcon} label="Auto-capture when steady" caption="Coming soon" disabled />
          <Divider />
          <Row Icon={OverlayIcon} label="Skeleton overlay" value={skeleton} onChange={setSkeleton} />
          <Divider />
          <Row Icon={VoiceIcon} label="Voice notes" caption="Coming soon" disabled />
        </Group>

        <Text style={styles.section}>PULSE AI</Text>
        <Group tone="lavender">
          <Row Icon={SparkleSingleIcon} label="Draft clinical notes" caption="Coming soon" disabled tone="lavender" />
          <Divider tone="lavender" />
          <Row Icon={GuidanceIcon} label="Live capture guidance" caption="Framing hints on the capture screen" value={guidance} onChange={setGuidance} tone="lavender" />
          <Text style={styles.disclaimer}>All AI output is a draft. Nothing enters the record without your sign-off.</Text>
        </Group>

        <Text style={styles.section}>ACCOUNT</Text>
        <Group>
          <Row Icon={PrivacyIcon} label="Privacy & data retention" caption="Coming soon" disabled chevron />
          <Divider />
          <Row Icon={LockDeviceIcon} label="Lock device" caption="Signs out of this device" onPress={lockDevice} chevron />
        </Group>

        <Text style={styles.footer}>
          PosturePulse AI {version} · pose guide: MoveNet Lightning on this device · measurements computed on the clinic server
        </Text>
      </ScrollView>
      <BottomTabBar />
    </View>
  );
}

function Group({ children, tone = "plain" }: { children: ReactNode; tone?: Tone }) {
  const lav = tone === "lavender";
  return (
    <GlassCard fill={lav ? colors.glassLavender : colors.glassCard} ring={lav ? colors.accent300 : colors.hairline} radius={20} elevated={false}>
      {children}
    </GlassCard>
  );
}

function Divider({ tone = "plain" }: { tone?: Tone }) {
  return <View style={[styles.divider, tone === "lavender" && { backgroundColor: colors.accent200 }]} />;
}

interface RowProps {
  Icon: ComponentType<IconProps>;
  label: string;
  caption?: string;
  tone?: Tone;
  /** Switch rows */
  value?: boolean;
  onChange?: (v: boolean) => void;
  /** Not built: visibly disabled, gray tile, switch (if any) off. */
  disabled?: boolean;
  /** Button rows */
  onPress?: () => void;
  chevron?: boolean;
}

function Row({ Icon, label, caption, tone = "plain", value, onChange, disabled, onPress, chevron }: RowProps) {
  const lav = tone === "lavender";
  const live = !disabled;
  const isSwitch = !chevron;
  const tile = lav
    ? { backgroundColor: colors.white, borderColor: colors.accent300 }
    : live && isSwitch
      ? { backgroundColor: colors.accent100, borderColor: colors.accent200 }
      : { backgroundColor: colors.bgTint, borderColor: colors.hairline };
  const iconColor = lav || (live && isSwitch) ? colors.accent700 : disabled ? colors.textMuted : colors.textSecondary;

  const content = (
    <>
      <View style={[styles.tile, tile]}>
        <Icon size={17} color={iconColor} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, disabled && { color: colors.textSecondary }]}>{label}</Text>
        {caption ? <Text style={styles.rowCaption}>{caption}</Text> : null}
      </View>
      {isSwitch ? (
        <DesignSwitch value={!!value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} />
      ) : (
        <ChevronRightIcon size={17} color={colors.textDisabled} />
      )}
    </>
  );

  if (isSwitch) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, disabled && { opacity: 0.5 }, pressed && { backgroundColor: colors.accent100 }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingTop: 58, paddingHorizontal: 22, paddingBottom: 110, gap: 14 },
  cardShadow: shadows.cardLg,
  userRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 17, paddingHorizontal: 16 },
  userText: { gap: 3, flexShrink: 1 },
  userName: { fontSize: 16, fontWeight: "600", letterSpacing: -0.32, color: colors.text },
  userMeta: { fontSize: 12.5, color: colors.textMuted },
  section: { marginTop: 4, fontSize: 11, fontWeight: "600", letterSpacing: 1.43, color: colors.textMuted },
  row: { flexDirection: "row", alignItems: "center", gap: 13, paddingVertical: 15, paddingHorizontal: 16 },
  tile: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 14, fontWeight: "500", color: colors.text },
  rowCaption: { fontSize: 11.5, color: colors.textFaint },
  divider: { height: 1, marginHorizontal: 16, backgroundColor: colors.bgDeep },
  disclaimer: { paddingHorizontal: 16, paddingBottom: 15, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  footer: { marginTop: 4, textAlign: "center", fontSize: 11.5, lineHeight: 17, color: colors.textFaint },
});
