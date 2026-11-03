import type { ReactNode } from "react";
import Svg, { Circle, Path } from "react-native-svg";

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

type Draw = () => ReactNode;

function make(defaultStroke: number, draw: Draw, round = false) {
  return function Icon({ size = 20, color = "#000", strokeWidth = defaultStroke }: IconProps) {
    return (
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap={round ? "round" : undefined}
        strokeLinejoin={round ? "round" : undefined}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {draw()}
      </Svg>
    );
  };
}

export const HomeIcon = make(1.9, () => <Path d="M4 11 12 4l8 7v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />);
export const PatientsIcon = make(1.9, () => (
  <>
    <Circle cx={9} cy={8} r={3.4} />
    <Path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
    <Path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.9c1.8.7 3 2.5 3 5.1" />
  </>
), true);
export const TrendsIcon = make(1.9, () => (
  <>
    <Path d="M4 19V5M4 19h16" />
    <Path d="m7.5 15 3.5-4 3 2.4L20 7" />
  </>
), true);
export const ProfileIcon = make(1.9, () => (
  <>
    <Circle cx={12} cy={8} r={3.6} />
    <Path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
  </>
));
export const CameraIcon = make(1.8, () => (
  <>
    <Path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h2L9 4h6l1.5 2h2A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
    <Circle cx={12} cy={13} r={3.6} />
  </>
));
export const BellIcon = make(1.8, () => (
  <>
    <Path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9" />
    <Path d="M10 18.5a2.2 2.2 0 0 0 4 0" />
  </>
));
export const BackIcon = make(2, () => <Path d="M15 5l-7 7 7 7" />, true);
export const ChevronRightIcon = make(2, () => <Path d="M9 5l7 7-7 7" />, true);
export const ArrowRightIcon = make(2.2, () => <Path d="M5 12h13M13 6.5l5.5 5.5L13 17.5" />, true);
export const ArrowUpIcon = make(2.2, () => <Path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" />, true);
export const ArrowDownIcon = make(2.2, () => <Path d="M12 5v13M6.5 12.5 12 18l5.5-5.5" />, true);
export const PlusIcon = make(2.2, () => <Path d="M12 5.5v13M5.5 12h13" />, true);
export const SearchIcon = make(2, () => (
  <>
    <Circle cx={11} cy={11} r={6.5} />
    <Path d="m16 16 4.5 4.5" />
  </>
), true);
export const CheckIcon = make(3, () => <Path d="m5 12.5 4.5 4.5L19 7.5" />, true);
export const SparkleIcon = make(1.8, () => (
  <>
    <Path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.3 10.1 12.8 4.5 10.9 10.1 9z" />
    <Path d="M18.5 16.5l.8 2.3 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  </>
));
export const MailIcon = make(1.8, () => (
  <>
    <Path d="M4 6.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
    <Path d="m3.5 8 8.5 6 8.5-6" />
  </>
), true);
export const LockIcon = make(1.8, () => (
  <>
    <Path d="M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
    <Path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </>
), true);
export const ShieldIcon = make(1.8, () => (
  <>
    <Path d="M12 3.5 5 6v5.5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z" />
    <Path d="m9 12 2.2 2.2L15 10" />
  </>
), true);
export const InfoIcon = make(1.8, () => (
  <>
    <Circle cx={12} cy={12} r={8.5} />
    <Path d="M12 11v5.2M12 7.8v.2" />
  </>
), true);
export const ShareIcon = make(1.8, () => (
  <>
    <Path d="M12 15V4M8 8l4-4 4 4" />
    <Path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12" />
  </>
), true);
export const MicIcon = make(1.8, () => (
  <>
    <Path d="M12 3.5a3 3 0 0 1 3 3V12a3 3 0 0 1-6 0V6.5a3 3 0 0 1 3-3z" />
    <Path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
  </>
), true);
export const SunIcon = make(1.8, () => (
  <>
    <Circle cx={12} cy={12} r={4} />
    <Path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
  </>
), true);
export const ClockIcon = make(1.8, () => (
  <>
    <Circle cx={12} cy={12} r={8.5} />
    <Path d="M12 7.5V12l3 2" />
  </>
), true);
export const RefreshIcon = make(1.9, () => (
  <>
    <Path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <Path d="M19.5 4.5v4h-4" />
  </>
), true);
export const LayoutIcon = make(1.8, () => (
  <>
    <Path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" />
    <Path d="M4 10h16M10 10v10" />
  </>
), true);
