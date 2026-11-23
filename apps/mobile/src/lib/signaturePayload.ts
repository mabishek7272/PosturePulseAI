// Turns the drawn strokes into what the server stores: SVG move/line path data in a
// width x height box. The server accepts ONLY "M", "L", digits, "." "-" and spaces
// (no curves, no script), within hard size limits - this keeps every drawing inside them.
import type { Stroke } from "./signature";

/** Mirror of services/backend-api/src/clinicians/clinician-profile.service.ts limits. */
export const MAX_SIGNATURE_PATHS = 40;
export const MAX_SIGNATURE_PATH_CHARS = 8000;
export const MAX_SIGNATURE_TOTAL_CHARS = 40000;

export interface SignaturePayload {
  width: number;
  height: number;
  paths: string[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function polyline(points: Stroke): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${r1(p.x)} ${r1(p.y)}`).join(" ");
}

/** Keep every `step`-th point, always keeping the last so the stroke still ends where it did. */
function thin(points: Stroke, step: number): Stroke {
  if (step <= 1 || points.length <= 2) return points;
  const kept = points.filter((_, i) => i % step === 0);
  const last = points[points.length - 1];
  if (last && kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}

/**
 * Builds the payload, thinning points evenly (never dropping a stroke) until it fits.
 * Returns null when there is nothing to send, or when it cannot be made to fit
 * (more than MAX_SIGNATURE_PATHS strokes).
 */
export function buildSignaturePayload(strokes: Stroke[], width: number, height: number): SignaturePayload | null {
  const usable = strokes.filter((s) => s.length > 0);
  if (usable.length === 0 || usable.length > MAX_SIGNATURE_PATHS) return null;
  if (!(width > 0) || !(height > 0)) return null;

  for (let step = 1; step <= 64; step *= 2) {
    const paths = usable.map((s) => polyline(s.length === 1 ? [s[0]!, { x: s[0]!.x + 0.1, y: s[0]!.y }] : thin(s, step)));
    const total = paths.reduce((n, p) => n + p.length, 0);
    if (paths.every((p) => p.length <= MAX_SIGNATURE_PATH_CHARS) && total <= MAX_SIGNATURE_TOTAL_CHARS) {
      return { width: r1(width), height: r1(height), paths };
    }
  }
  return null;
}
