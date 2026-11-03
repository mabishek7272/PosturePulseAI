/**
 * Pure layout maths for the capture screen. The operator must see the whole
 * body, feet included, so the central column of the camera view is kept free
 * of UI. Only the translucent body outline, the pose skeleton, the centre and
 * ground-line cues and the small hold toast may sit there. The top glass strip
 * and the slim bottom control row are the two bands of chrome; they are
 * translucent / short and bounded here. The big progress ring lives on the
 * right edge, outside the column. Rectangles are estimates used for sizing and
 * tests; the screen lays itself out with flex inside these bands.
 */

export interface Rect { x: number; y: number; w: number; h: number }
export interface Insets { top: number; bottom: number }

/** Protected column: x 22%..78% of the width, y 8%..92% of the height. */
export const CENTRE_X0 = 0.22;
export const CENTRE_X1 = 0.78;
export const CENTRE_Y0 = 0.08;
export const CENTRE_Y1 = 0.92;

export const SHUTTER = 82;
export const SIDE_PAD = 20;
export const HEADER_TOP_GAP = 14;
export const HEADER_H = 34;
/** ViewProgress: marginTop 14 + bar 3 + gap 6 + label ~12. */
export const PROGRESS_H = 14 + 3 + 6 + 12;
export const STRIP_GAP = 8;
export const RING_MAX = 160;
export const RING_MIN = 68;
export const RING_RIGHT_MARGIN = 4;
/** Centre of the ring, as a fraction of the screen height. */
export const RING_CENTRE_Y = 0.35;
/** Rough width of one guidance chip (10 px label + mark + padding). */
const CHIP_W = 68;
const CHIP_GAP = 5;
const CHIP_H = 20;
const CHIP_COUNT = 6;

export function protectedColumn(width: number, height: number): Rect {
  return { x: CENTRE_X0 * width, y: CENTRE_Y0 * height, w: (CENTRE_X1 - CENTRE_X0) * width, h: (CENTRE_Y1 - CENTRE_Y0) * height };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Ring diameter: 160 on iPad portrait, shrinking so it stays in the outer 22% of the width on phones. */
export function ringDiameter(width: number): number {
  return Math.max(RING_MIN, Math.min(RING_MAX, Math.floor(CENTRE_X0 * width) - 6));
}

export interface CaptureLayout {
  width: number;
  height: number;
  /** Header + view progress bar (always shown). */
  header: Rect;
  /** Guidance strip before recording, SQI strip during it (same slot, estimated height). */
  topStrip: Rect;
  /** Progress ring during countdown and hold. */
  ring: Rect;
  /** Slim bottom row: buttons, shutter, one caption line. */
  bottomControls: Rect;
  centre: Rect;
}

export function computeCaptureLayout(width: number, height: number, insets: Insets): CaptureLayout {
  const headerH = HEADER_TOP_GAP + HEADER_H + PROGRESS_H;
  const header: Rect = { x: SIDE_PAD, y: insets.top, w: width - 2 * SIDE_PAD, h: headerH };

  const avail = Math.max(1, width - 2 * SIDE_PAD - 20);
  const perRow = Math.max(1, Math.floor((avail + CHIP_GAP) / (CHIP_W + CHIP_GAP)));
  const rows = Math.ceil(CHIP_COUNT / perRow);
  const stripH = 10 + 18 + 6 + rows * CHIP_H + (rows - 1) * CHIP_GAP + 10;
  const topStrip: Rect = { x: SIDE_PAD, y: header.y + header.h + STRIP_GAP, w: width - 2 * SIDE_PAD, h: stripH };

  const d = ringDiameter(width);
  const ringTop = Math.max(topStrip.y + topStrip.h + 28, RING_CENTRE_Y * height - d / 2);
  const ring: Rect = { x: width - RING_RIGHT_MARGIN - d, y: ringTop, w: d, h: d };

  const ctrlH = SHUTTER + 8 + 14 + Math.max(8, insets.bottom);
  const bottomControls: Rect = { x: 0, y: height - ctrlH, w: width, h: ctrlH };

  return { width, height, header, topStrip, ring, bottomControls, centre: protectedColumn(width, height) };
}

/**
 * Names of rectangles that break the clear-view rule. The ring must stay out of
 * the column outright. The top strip and bottom row are the only chrome allowed
 * to touch it, and only while short: the strip must end above 40% of the height
 * and the bottom row must start below 80%. Empty list = layout is fine.
 */
export function centreViolations(l: CaptureLayout): string[] {
  const out: string[] = [];
  if (intersects(l.ring, l.centre)) out.push("ring");
  if (l.topStrip.y + l.topStrip.h > 0.4 * l.height) out.push("topStrip");
  if (l.bottomControls.y < 0.8 * l.height) out.push("bottomControls");
  if (intersects(l.topStrip, l.bottomControls)) out.push("strip/bottom overlap");
  if (intersects(l.ring, l.topStrip) || intersects(l.ring, l.bottomControls)) out.push("ring overlaps chrome");
  return out;
}

export function assertCentreClear(l: CaptureLayout): void {
  const v = centreViolations(l);
  if (v.length) throw new Error(`Capture layout covers the camera view: ${v.join(", ")}`);
}
