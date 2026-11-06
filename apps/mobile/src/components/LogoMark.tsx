import { Image } from "react-native";

/** The PosturePulse emblem (spine, pulse and network) - the same artwork as the app icon and splash. */
export const EMBLEM = require("../../assets/images/splash-icon.png");
/** Width / height of the emblem artwork (600 x 518). */
export const EMBLEM_ASPECT = 600 / 518;

/**
 * The brand mark. Was a two-stroke "S" drawn in SVG, which read as "SS"; it is
 * now the real emblem. `size` is the width; colour props are accepted for
 * call-site compatibility and ignored (the artwork has its own colours).
 */
export function LogoMark({ size = 34 }: {
  size?: number; top?: string; bottom?: string; strokeWidth?: number;
}) {
  return (
    <Image
      source={EMBLEM}
      style={{ width: size, height: size / EMBLEM_ASPECT }}
      resizeMode="contain"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
