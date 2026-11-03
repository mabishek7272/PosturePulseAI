import { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Line, Path } from "react-native-svg";
import { strokeToPath, type Point, type Stroke } from "../lib/signature";
import { colors } from "../theme/colors";
import { radii } from "../theme/radii";

type Props = {
  strokes: Stroke[];
  onChange: (strokes: Stroke[]) => void;
  /** Called with false on touch start and true on release, so the parent can lock its scroll. */
  onDrawingChange?: (drawing: boolean) => void;
  disabled?: boolean;
};

export function SignaturePad({ strokes, onChange, onDrawingChange, disabled }: Props) {
  const [live, setLive] = useState<Stroke | null>(null);
  const liveRef = useRef<Stroke | null>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const propsRef = useRef({ onChange, onDrawingChange, disabled });
  propsRef.current = { onChange, onDrawingChange, disabled };

  const responder = useMemo(() => {
    const pt = (e: { nativeEvent: { locationX: number; locationY: number } }): Point => ({
      x: e.nativeEvent.locationX,
      y: e.nativeEvent.locationY,
    });
    const finish = () => {
      const s = liveRef.current;
      liveRef.current = null;
      setLive(null);
      propsRef.current.onDrawingChange?.(false);
      if (s && s.length > 0) propsRef.current.onChange([...strokesRef.current, s]);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !propsRef.current.disabled,
      onMoveShouldSetPanResponder: () => !propsRef.current.disabled,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        propsRef.current.onDrawingChange?.(true);
        liveRef.current = [pt(e)];
        setLive(liveRef.current);
      },
      onPanResponderMove: (e) => {
        if (!liveRef.current) return;
        liveRef.current = [...liveRef.current, pt(e)];
        setLive(liveRef.current);
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    });
  }, []);

  const paths = useMemo(() => strokes.map(strokeToPath), [strokes]);
  const livePath = live ? strokeToPath(live) : "";
  const hasInk = strokes.length > 0 || !!live;

  return (
    <View
      style={styles.pad}
      accessible
      accessibilityLabel="Patient signature pad. Draw the signature with a finger or stylus."
      {...responder.panHandlers}
    >
      <Svg width="100%" height="100%" pointerEvents="none">
        <Line x1="34" y1="124" x2="100%" y2="124" stroke={colors.hairlineStrong} strokeWidth={1} strokeDasharray="3 4" />
        {paths.map((d, i) => (
          <Path key={i} d={d} stroke={colors.accent700} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {livePath ? (
          <Path d={livePath} stroke={colors.accent700} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ) : null}
      </Svg>
      {!hasInk && <Text style={styles.hint} pointerEvents="none">Sign here</Text>}
      <Pressable
        style={[styles.clear, !hasInk && styles.clearOff]}
        disabled={!hasInk}
        onPress={() => onChange([])}
        accessibilityRole="button"
        accessibilityLabel="Clear signature"
        accessibilityState={{ disabled: !hasInk }}
      >
        <Text style={styles.clearText}>Clear</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    height: 150, borderRadius: radii.lg, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.hairline,
    overflow: "hidden",
  },
  hint: { position: "absolute", left: 0, right: 0, top: 62, textAlign: "center", fontSize: 12, color: colors.textFaint },
  clear: {
    position: "absolute", right: 11, top: 11, height: 30, paddingHorizontal: 11, borderRadius: radii.sm,
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline, justifyContent: "center",
  },
  clearOff: { opacity: 0.5 },
  clearText: { fontSize: 11.5, fontWeight: "600", color: colors.textMuted },
});
