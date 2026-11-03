import { useEffect } from "react";
import { Pressable, StyleSheet } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { colors } from "../theme/colors";
import { shadows } from "../theme/shadows";

export interface DesignSwitchProps {
  value: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}

const W = 44;
const H = 26;
const PAD = 3;
const THUMB = 20;

/** 44x26 violet toggle with white thumb. */
export function DesignSwitch({ value, onValueChange, disabled = false, accessibilityLabel }: DesignSwitchProps) {
  const p = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(value ? 1 : 0, { duration: 180 });
  }, [value, p]);

  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], [colors.hairline, colors.accent600]),
  }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: p.value * (W - THUMB - PAD * 2) }] }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange?.(!value)}
      hitSlop={8}
    >
      <Animated.View style={[styles.track, track, disabled && styles.disabled]}>
        <Animated.View style={[styles.thumb, shadows.thumb, thumb]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: W, height: H, borderRadius: H / 2, padding: PAD, justifyContent: "center" },
  thumb: { width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: colors.white },
  disabled: { opacity: 0.5 },
});
