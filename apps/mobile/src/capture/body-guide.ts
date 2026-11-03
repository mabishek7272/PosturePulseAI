import { BAND_FEET_Y, DISTANCE_MAX, DISTANCE_MIN } from "./guidance";
import { coverMap } from "./pose-overlay";

/** Path data lives in a 100 x 240 box (head top at y=6, soles at y=232). */
export const GUIDE_VIEWBOX = { w: 100, h: 240 };
/** Fraction of the viewBox height that head-to-feet occupies. */
const BODY_SPAN = (232 - 6) / GUIDE_VIEWBOX.h;

export interface GuideBox { x: number; y: number; w: number; h: number }

/**
 * Where the framing outline sits in a view of the given size. The camera
 * frame is 3:4 and cover-mapped. Head-to-feet spans the middle of the
 * guidance distance band (keypoint span DISTANCE_MIN..DISTANCE_MAX of the
 * frame height), centred horizontally, with the feet ending at BAND_FEET_Y of
 * the frame height: the lowest an ankle may sit so the server still sees the
 * heels inside its frame. A framing aid, not a measurement.
 */
export function bodyGuideBox(viewW: number, viewH: number): GuideBox | null {
  const span = (DISTANCE_MIN + DISTANCE_MAX) / 2;
  const top = coverMap(0.5, BAND_FEET_Y - span, 3, 4, viewW, viewH);
  const bottom = coverMap(0.5, BAND_FEET_Y, 3, 4, viewW, viewH);
  if (!top || !bottom) return null;
  const bodyH = bottom[1] - top[1];
  const h = bodyH / BODY_SPAN;
  const w = (h * GUIDE_VIEWBOX.w) / GUIDE_VIEWBOX.h;
  const y = top[1] - (6 / GUIDE_VIEWBOX.h) * h;
  return { x: top[0] - w / 2, y, w, h };
}

export type GuideKind = "frontal" | "lateral";
export function guideKind(view: string): GuideKind {
  return view === "left_lateral" || view === "right_lateral" ? "lateral" : "frontal";
}

export const FRONTAL_HEAD = { cx: 50, cy: 20, r: 14 };
export const FRONTAL_BODY =
  "M43 35 L43 43 C34 45 24 47 21 54 L13 112 Q11 124 16 126 Q22 127 23 116 L30 72 L31 118 L28 150 L30 232 L46 232 L48 150 L50 130 L52 150 L54 232 L70 232 L72 150 L69 118 L70 72 L77 116 Q78 127 84 126 Q89 124 87 112 L79 54 C76 47 66 45 57 43 L57 35";

export const LATERAL_HEAD = { cx: 50, cy: 20, r: 13 };
export const LATERAL_BODY =
  "M45 34 L45 42 C36 45 35 54 36 66 L37 112 L36 132 L40 160 L40 232 L66 232 L66 224 L55 222 L56 160 L62 132 L63 112 L62 66 C62 50 58 45 55 42 L55 34 M48 52 L46 112 Q46 121 50 121 Q54 121 54 112 L53 52";
