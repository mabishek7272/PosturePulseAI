import { useEffect, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, Line } from "react-native-svg";
import { BONES, KEYPOINT_COUNT, boneSegment, jointPosition, type PoseSnapshot } from "../capture/pose-overlay";
import { colors } from "../theme/colors";

const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const JOINT_CYCLE_MS = 2400; // ppJoint
const JOINT_STAGGER = 0.1 / 2.4; // design staggers joints ~0.1s into the 2.4s cycle

interface Props {
  pose: SharedValue<PoseSnapshot>;
}

function jointPulse(p: number, index: number): number {
  'worklet';
  const q = (((p - index * JOINT_STAGGER) % 1) + 1) % 1;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * q);
}

function Bone({ pose, bone, w, h }: { pose: SharedValue<PoseSnapshot>; bone: readonly [number, number]; w: number; h: number }) {
  const props = useAnimatedProps(() => {
    const seg = boneSegment(pose.value, bone, w, h);
    return seg ? { x1: seg[0], y1: seg[1], x2: seg[2], y2: seg[3], opacity: 0.92 } : { x1: 0, y1: 0, x2: 0, y2: 0, opacity: 0 };
  });
  return (
    <AnimatedLine
      animatedProps={props}
      stroke={colors.accent400}
      strokeWidth={1.8}
      strokeLinecap="round"
    />
  );
}

function Joint({
  pose, index, phase, w, h,
}: { pose: SharedValue<PoseSnapshot>; index: number; phase: SharedValue<number>; w: number; h: number }) {
  // ppJoint: opacity .45 -> 1 and r 3.2 -> 4.6 and back, staggered per joint.
  const core = useAnimatedProps(() => {
    const p = jointPosition(pose.value, index, w, h);
    if (!p) return { cx: 0, cy: 0, r: 0, opacity: 0 };
    const t = jointPulse(phase.value, index);
    return { cx: p[0], cy: p[1], r: 3.2 + 1.4 * t, opacity: 0.45 + 0.55 * t };
  });
  const halo = useAnimatedProps(() => {
    const p = jointPosition(pose.value, index, w, h);
    if (!p) return { cx: 0, cy: 0, r: 0, opacity: 0 };
    const t = jointPulse(phase.value, index);
    return { cx: p[0], cy: p[1], r: 7 + 3 * t, opacity: 0.1 + 0.2 * t };
  });
  return (
    <>
      <AnimatedCircle animatedProps={halo} fill={colors.accent400} />
      <AnimatedCircle animatedProps={core} fill={colors.accent100} />
    </>
  );
}

/**
 * Draws the live pose-guide skeleton over the camera preview. Alignment aid
 * only - see capture/pose-overlay.ts. Reads keypoints from a shared value
 * written by the frame-output worklet, so it re-renders nothing per frame.
 */
export function PoseOverlay({ pose }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const phase = useSharedValue(0);
  useEffect(() => {
    phase.value = withRepeat(withTiming(1, { duration: JOINT_CYCLE_MS, easing: Easing.linear }), -1, false);
  }, [phase]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  const joints = Array.from({ length: KEYPOINT_COUNT }, (_, i) => i);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {size.w > 0 ? (
        <Svg width={size.w} height={size.h}>
          {BONES.map((b) => (
            <Bone key={`${b[0]}-${b[1]}`} pose={pose} bone={b} w={size.w} h={size.h} />
          ))}
          {joints.map((i) => (
            <Joint key={i} pose={pose} index={i} phase={phase} w={size.w} h={size.h} />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}
