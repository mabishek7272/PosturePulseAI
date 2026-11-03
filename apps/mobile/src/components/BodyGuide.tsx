import { StyleSheet } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import {
  bodyGuideBox, FRONTAL_BODY, FRONTAL_HEAD, GUIDE_VIEWBOX, guideKind, LATERAL_BODY, LATERAL_HEAD,
} from "../capture/body-guide";
import { colors } from "../theme/colors";

/**
 * See-through human outline showing where to stand: head to feet fills the
 * span the distance check treats as in range, centred. A FRAMING GUIDE ONLY,
 * not a measurement or a body model. Neutral violet-white until every
 * alignment check passes, then green. Drawn below the skeleton, never
 * intercepts touches.
 */
export function BodyGuide({
  width, height, view, aligned,
}: { width: number; height: number; view: string; aligned: boolean }) {
  const box = bodyGuideBox(width, height);
  if (!box) return null;
  const lateral = guideKind(view) === "lateral";
  const head = lateral ? LATERAL_HEAD : FRONTAL_HEAD;
  const body = lateral ? LATERAL_BODY : FRONTAL_BODY;
  const stroke = aligned ? colors.captureAligned : colors.captureGuideStroke;
  const fill = aligned ? colors.captureAligned : colors.white;
  // The lateral path faces right (the right side to camera); mirror for left.
  const flip = view === "left_lateral";
  return (
    <Svg
      pointerEvents="none"
      accessibilityLabel="Framing guide outline"
      style={[StyleSheet.absoluteFill, { opacity: 1 }]}
      width={width} height={height}
    >
      <G
        transform={`translate(${box.x} ${box.y}) scale(${box.w / GUIDE_VIEWBOX.w} ${box.h / GUIDE_VIEWBOX.h})`}
      >
        <G transform={flip ? `translate(${GUIDE_VIEWBOX.w} 0) scale(-1 1)` : undefined}>
          {/* soft glow underlay */}
          <Circle cx={head.cx} cy={head.cy} r={head.r} stroke={stroke} strokeOpacity={0.12} strokeWidth={4} fill="none" />
          <Path d={body} stroke={stroke} strokeOpacity={0.12} strokeWidth={4} strokeLinejoin="round" fill="none" />
          <Circle
            cx={head.cx} cy={head.cy} r={head.r} stroke={stroke} strokeOpacity={aligned ? 0.5 : 0.32}
            strokeWidth={1.3} strokeDasharray={aligned ? undefined : "4 3"} fill={fill} fillOpacity={0.05}
          />
          <Path
            d={body} stroke={stroke} strokeOpacity={aligned ? 0.5 : 0.32} strokeWidth={1.3} strokeLinejoin="round"
            strokeDasharray={aligned ? undefined : "4 3"} fill={fill} fillOpacity={0.05}
          />
        </G>
      </G>
    </Svg>
  );
}
