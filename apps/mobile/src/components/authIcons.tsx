import Svg, { Circle, Path, Rect } from "react-native-svg";

interface P { size?: number; color: string; strokeWidth?: number }

function Frame({ size, color, strokeWidth, children, round = false }: P & { children: React.ReactNode; round?: boolean }) {
  return (
    <Svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}
      strokeLinecap={round ? "round" : undefined}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    >
      {children}
    </Svg>
  );
}

/** Icons for login/permissions, with the exact paths from the design file. */
export const FieldMailIcon = ({ size = 17, color, strokeWidth = 1.8 }: P) => (
  <Frame size={size} color={color} strokeWidth={strokeWidth}>
    <Rect x={2.5} y={5} width={19} height={14} rx={2.5} />
    <Path d="m3 7 9 6 9-6" />
  </Frame>
);
export const FieldLockIcon = ({ size = 17, color, strokeWidth = 1.8 }: P) => (
  <Frame size={size} color={color} strokeWidth={strokeWidth}>
    <Rect x={4} y={10.5} width={16} height={10.5} rx={2.5} />
    <Path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </Frame>
);
export const BadgeShieldIcon = ({ size = 17, color, strokeWidth = 1.8 }: P) => (
  <Frame size={size} color={color} strokeWidth={strokeWidth}>
    <Path d="M12 2.5 4 6v5.5c0 5 3.4 9 8 10 4.6-1 8-5 8-10V6z" />
    <Path d="m9 12 2 2 4-4" />
  </Frame>
);
export const InfoCircleIcon = ({ size = 16, color, strokeWidth = 1.8 }: P) => (
  <Frame size={size} color={color} strokeWidth={strokeWidth}>
    <Circle cx={12} cy={12} r={9.5} />
    <Path d="M12 11v6M12 7.6v.1" />
  </Frame>
);
export const PermCameraIcon = ({ size = 20, color, strokeWidth = 1.7 }: P) => (
  <Frame size={size} color={color} strokeWidth={strokeWidth}>
    <Path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h2L9 4h6l1.5 2h2A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
    <Circle cx={12} cy={13} r={3.6} />
  </Frame>
);
export const MotionIcon = ({ size = 20, color, strokeWidth = 1.7 }: P) => (
  <Frame size={size} color={color} strokeWidth={strokeWidth}>
    <Circle cx={12} cy={12} r={2.6} />
    <Path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2.1 2.1M15.9 15.9 18 18M18 6l-2.1 2.1M8.1 15.9 6 18" />
  </Frame>
);
export const PermMicIcon = ({ size = 20, color, strokeWidth = 1.7 }: P) => (
  <Frame size={size} color={color} strokeWidth={strokeWidth}>
    <Rect x={9} y={3} width={6} height={11} rx={3} />
    <Path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
  </Frame>
);
