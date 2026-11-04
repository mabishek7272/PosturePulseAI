// Pure signature helpers. The signature lives only in component state; nothing here
// touches disk, network or logs.
import { required } from "./required";

export type Point = { x: number; y: number };
export type Stroke = Point[];

/** Total drawn path length across all strokes, in pad pixels. */
export function totalLength(strokes: Stroke[]): number {
  let sum = 0;
  for (const s of strokes) {
    // Pairwise via a carried previous point, rather than `s[i]` / `s[i - 1]`.
    let previous: Point | undefined;
    for (const p of s) {
      if (previous) sum += Math.hypot(p.x - previous.x, p.y - previous.y);
      previous = p;
    }
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
  const [p0, p1] = stroke;
  if (!p0) return ""; // length 0
  if (stroke.length === 1) return `M${r(p0.x)} ${r(p0.y)}l0.01 0`;
  if (p1 && stroke.length === 2) return `M${r(p0.x)} ${r(p0.y)}L${r(p1.x)} ${r(p1.y)}`;
  let d = `M${r(p0.x)} ${r(p0.y)}`;
  for (let i = 1; i < stroke.length - 1; i++) {
    // Both reads are proven by the loop bound (1 <= i, i + 1 <= length - 1).
    const cur = required(stroke[i], "stroke[i] exists inside the loop bound");
    const next = required(stroke[i + 1], "stroke[i + 1] exists inside the loop bound");
    const mx = (cur.x + next.x) / 2;
    const my = (cur.y + next.y) / 2;
    d += `Q${r(cur.x)} ${r(cur.y)} ${r(mx)} ${r(my)}`;
  }
  const last = required(stroke[stroke.length - 1], "stroke has at least 3 points here");
  return `${d}L${r(last.x)} ${r(last.y)}`;
}

/** Serialise all strokes to a single SVG path string (for a future consent-record field). */
export function serialiseSignature(strokes: Stroke[]): string {
  return strokes.map(strokeToPath).filter(Boolean).join(" ");
}
