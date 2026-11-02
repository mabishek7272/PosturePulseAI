import type { ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View, type ViewStyle } from "react-native";
import { colors } from "../theme/colors";

/** Width at or above which we treat the device as a tablet. */
const TABLET_BREAKPOINT = 768;

/**
 * A comfortable reading and form width. Beyond this, content is centred with
 * space either side rather than stretched - a 1024pt-wide text input looks
 * broken, not spacious.
 */
export const MAX_CONTENT_WIDTH = 580;

export interface Responsive {
  isTablet: boolean;
  gutter: number;
  titleSize: number;
  bodySize: number;
  /** Vertical rhythm between major blocks. */
  spacing: number;
}

export function useResponsive(): Responsive {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BREAKPOINT;
  return {
    isTablet,
    gutter: isTablet ? 40 : 24,
    titleSize: isTablet ? 40 : 30,
    bodySize: isTablet ? 17 : 15,
    spacing: isTablet ? 28 : 20,
  };
}

/**
 * Standard screen chrome: the app background, a horizontal gutter, and a
 * centred column capped at a readable width on large displays.
 *
 * `center` vertically centres the column, for short screens such as login.
 * Scrolling or list-based screens should leave it off and fill the height.
 */
export function Screen({
  children,
  center = false,
  style,
}: {
  children: ReactNode;
  center?: boolean;
  style?: ViewStyle;
}) {
  const { gutter } = useResponsive();
  return (
    <View style={[styles.root, { paddingHorizontal: gutter }, style]}>
      <View style={[styles.column, center && styles.centered]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep },
  column: { flex: 1, width: "100%", maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center" },
  centered: { justifyContent: "center" },
});
