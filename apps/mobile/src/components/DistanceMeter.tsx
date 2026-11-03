import { StyleSheet, Text, View } from "react-native";
import type { DistanceState } from "../capture/guidance";
import { distanceBandFractions, distanceLabel, distanceMarkerFraction, distanceTone } from "../capture/distance-meter";
import { colors } from "../theme/colors";

const TONE = { green: colors.captureAligned, amber: colors.captureAmber, grey: "#8d90a0" } as const;

/**
 * Vertical distance gauge (right outer column, lower half). The shaded green band is the guidance
 * distance band (DISTANCE_MIN..DISTANCE_MAX of the head-to-ankle keypoint span); the marker is the
 * person's current span. Closer to the camera = larger span = higher on the track. Filming
 * condition only: no distances are claimed.
 */
export function DistanceMeter({ span, state, width, height }: { span: number | null; state: DistanceState; width: number; height: number }) {
  const labelH = 30;
  const trackH = Math.max(40, height - labelH);
  const tone = distanceTone(state);
  const color = TONE[tone];
  const f = distanceMarkerFraction(span); // 0 = top of track
  const band = distanceBandFractions();
  const bandTop = band.top * trackH;
  const bandH = (band.bottom - band.top) * trackH;
  const label = distanceLabel(state);
  return (
    <View style={{ width, height, alignItems: "center" }} pointerEvents="none" accessible accessibilityRole="image" accessibilityLabel={`Distance: ${label}`}>
      <View style={[styles.track, { height: trackH }]}>
        <View style={[styles.band, { top: bandTop, height: bandH }]} />
        {f !== null ? (
          <View style={[styles.marker, { top: f * trackH - 6, backgroundColor: color, shadowColor: color }]} />
        ) : null}
      </View>
      <Text style={[styles.label, { color }]} numberOfLines={2}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 16, borderRadius: 8, backgroundColor: "rgba(10,8,24,0.62)", borderWidth: 1, borderColor: "rgba(210,206,253,0.4)",
  },
  band: { position: "absolute", left: 0, right: 0, backgroundColor: "rgba(143,227,192,0.38)", borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.captureAligned },
  marker: {
    position: "absolute", left: -6, right: -6, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: colors.white,
    shadowOpacity: 0.8, shadowRadius: 5, shadowOffset: { width: 0, height: 0 },
  },
  label: { marginTop: 6, fontSize: 11, fontWeight: "700", textAlign: "center", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 },
});
