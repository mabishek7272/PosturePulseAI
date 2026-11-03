// Pure signature helpers. The signature lives only in component state; nothing here
// touches disk, network or logs.
export type Point = { x: number; y: number };
export type Stroke = Point[];

/** Total drawn path length across all strokes, in pad pixels. */
export function totalLength(strokes: Stroke[]): number {
  let sum = 0;
  for (const s of strokes) {
    for (let i = 1; i < s.length; i++) sum += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
  }
  return sum;
}

export const MIN_SIGNATURE_LENGTH = 60;
export const MIN_SIGNATURE_POINTS = 8;

/** A stray dot or tiny scratch is not a signature. */
export function hasMinimumInk(strokes: Stroke[]): boolean {
  const points = strokes.reduce((n, s) => n + s.length, 0);
  return points >= MIN_SIGNATURE_POINTS && totalLength(strokes) >= MIN_SIGNATURE_LENGTH;
}

const r = (n: number) => Math.round(n * 10) / 10;

/** One stroke as a smooth SVG path (quadratic curves through midpoints). */
export function strokeToPath(stroke: Stroke): string {
  if (stroke.length === 0) return "";
  const [p0] = stroke;
  if (stroke.length === 1) return `M${r(p0.x)} ${r(p0.y)}l0.01 0`;
  if (stroke.length === 2) return `M${r(p0.x)} ${r(p0.y)}L${r(stroke[1].x)} ${r(stroke[1].y)}`;
  let d = `M${r(p0.x)} ${r(p0.y)}`;
  for (let i = 1; i < stroke.length - 1; i++) {
    const mx = (stroke[i].x + stroke[i + 1].x) / 2;
    const my = (stroke[i].y + stroke[i + 1].y) / 2;
    d += `Q${r(stroke[i].x)} ${r(stroke[i].y)} ${r(mx)} ${r(my)}`;
  }
  const last = stroke[stroke.length - 1];
  return `${d}L${r(last.x)} ${r(last.y)}`;
}

/** Serialise all strokes to a single SVG path string (for a future consent-record field). */
export function serialiseSignature(strokes: Stroke[]): string {
  return strokes.map(strokeToPath).filter(Boolean).join(" ");
}
