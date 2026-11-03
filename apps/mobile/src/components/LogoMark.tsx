import Svg, { Path } from "react-native-svg";
import { colors } from "../theme/colors";

/** The two-stroke "S" pulse mark from the design (viewBox 32). */
export const LOGO_PATH_TOP = "M16 3c-4.2 0-6.6 2.4-6.6 5.6 0 4.6 6.6 5.1 6.6 9.3 0 3.1-2.3 5.5-6.4 5.5";
export const LOGO_PATH_BOTTOM = "M16 29c4.2 0 6.6-2.4 6.6-5.6 0-4.6-6.6-5.1-6.6-9.3 0-3.1 2.3-5.5 6.4-5.5";

export function LogoMark({ size = 34, top = colors.accent600, bottom = colors.accent400, strokeWidth = 2.4 }: {
  size?: number; top?: string; bottom?: string; strokeWidth?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={LOGO_PATH_TOP} stroke={top} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d={LOGO_PATH_BOTTOM} stroke={bottom} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
