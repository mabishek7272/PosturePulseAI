import type { ReactNode } from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import type { IconProps } from "./icons";

function Frame({ size = 17, color = "#000", strokeWidth = 1.8, round = false, children }: IconProps & { round?: boolean; children: ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap={round ? "round" : undefined}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {children}
    </Svg>
  );
}

/** Profile row glyphs, paths copied from design section 12. */
export const AutoCaptureIcon = (p: IconProps) => (
  <Frame {...p} round><Path d="M12 3.5v17M5 10l7-6.5 7 6.5" /></Frame>
);
export const OverlayIcon = (p: IconProps) => (
  <Frame {...p}><Rect x={3} y={5} width={18} height={14} rx={2.5} /><Path d="M3 10h18" /></Frame>
);
export const VoiceIcon = (p: IconProps) => (
  <Frame {...p} round><Rect x={9} y={3} width={6} height={11} rx={3} /><Path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" /></Frame>
);
export const SparkleSingleIcon = (p: IconProps) => (
  <Frame {...p}><Path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.3 10.1 12.8 4.5 10.9 10.1 9z" /></Frame>
);
export const GuidanceIcon = (p: IconProps) => (
  <Frame {...p} round><Circle cx={12} cy={12} r={8.5} /><Path d="M12 8v5l3 2" /></Frame>
);
export const PrivacyIcon = (p: IconProps) => (
  <Frame {...p}><Path d="M12 2.5 4 6v5.5c0 5 3.4 9 8 10 4.6-1 8-5 8-10V6z" /></Frame>
);
export const LockDeviceIcon = (p: IconProps) => (
  <Frame {...p} round><Path d="M15 4.5h3.5A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5H15" /><Path d="M11 8.5 14.5 12 11 15.5M14 12H4" /></Frame>
);
