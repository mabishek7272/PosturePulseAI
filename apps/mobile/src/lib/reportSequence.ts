/**
 * Pure logic for the "Report generation" sequence on the analysis screen.
 * Everything here is derived from on-device pre-check stats (capture/session-stats)
 * or from the angle itself. Nothing is estimated: a missing value stays null.
 * SQI ("Capture quality") is NOT a clinical score.
 */
import type { ClipStats } from "../capture/session-stats";
import type { SqiBand } from "../capture/sqi";

export const REPORT_VIEWS = [
  { stepId: "static.anterior", label: "FRONT" },
  { stepId: "static.left_lateral", label: "LEFT" },
  { stepId: "static.right_lateral", label: "RIGHT" },
  { stepId: "static.posterior", label: "BACK" },
] as const;

export const MAX_STARS_PER_VIEW = 3;

export interface ViewReport {
  stepId: string;
  label: string;
  /** True when the app holds capture stats for this view. */
  hasStats: boolean;
  sqi: number | null;
  band: SqiBand | null;
  stars: 1 | 2 | 3 | null;
  framesAnalysed: number;
  framesKept: number;
  framesFiltered: number;
  longestSteadySeconds: number;
  meanRollDegrees: number | null;
}

export interface ReportSummary {
  views: ViewReport[];
  hasAny: boolean;
  /** Views with a numeric SQI. */
  sqiViews: number;
  /** Rounded mean of the available SQIs, or null when none. */
  overallSqi: number | null;
  framesAnalysed: number;
  framesKept: number;
  framesFiltered: number;
  starsTotal: number;
  starsMax: number;
  bestSteadySeconds: number;
  /** All four views have capture stats. */
  fullSet: boolean;
  /** Views that have a usable mean roll (for the tilt card). */
  rollViews: ViewReport[];
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const count = (n: unknown) => (finite(n) && n > 0 ? Math.round(n) : 0);

export function buildReport(entries: readonly (readonly [string, ClipStats])[]): ReportSummary {
  const byStep = new Map(entries.map(([k, v]) => [k, v] as const));
  const views: ViewReport[] = REPORT_VIEWS.map(({ stepId, label }) => {
    const s = byStep.get(stepId);
    if (!s) {
      return { stepId, label, hasStats: false, sqi: null, band: null, stars: null, framesAnalysed: 0, framesKept: 0, framesFiltered: 0, longestSteadySeconds: 0, meanRollDegrees: null };
    }
    const sqi = finite(s.sqi) ? Math.min(100, Math.max(0, Math.round(s.sqi))) : null;
    return {
      stepId,
      label,
      hasStats: true,
      sqi,
      band: sqi === null ? null : s.band,
      stars: sqi === null ? null : s.stars,
      framesAnalysed: count(s.framesAnalysed),
      framesKept: count(s.framesKept),
      framesFiltered: count(s.framesFiltered),
      longestSteadySeconds: finite(s.longestSteadySeconds) ? Math.max(0, s.longestSteadySeconds) : 0,
      meanRollDegrees: finite(s.meanRollDegrees) ? s.meanRollDegrees : null,
    };
  });
  const withSqi = views.filter((v) => v.sqi !== null);
  const overallSqi = withSqi.length ? Math.round(withSqi.reduce((a, v) => a + (v.sqi as number), 0) / withSqi.length) : null;
  return {
    views,
    hasAny: views.some((v) => v.hasStats),
    sqiViews: withSqi.length,
    overallSqi,
    framesAnalysed: views.reduce((a, v) => a + v.framesAnalysed, 0),
    framesKept: views.reduce((a, v) => a + v.framesKept, 0),
    framesFiltered: views.reduce((a, v) => a + v.framesFiltered, 0),
    starsTotal: views.reduce((a, v) => a + (v.stars ?? 0), 0),
    starsMax: MAX_STARS_PER_VIEW * REPORT_VIEWS.length,
    bestSteadySeconds: views.reduce((a, v) => Math.max(a, v.longestSteadySeconds), 0),
    fullSet: views.every((v) => v.hasStats),
    rollViews: views.filter((v) => v.meanRollDegrees !== null),
  };
}

/** Fraction of pre-check frames kept, 0..1, or null when no frames were analysed. */
export function keptFraction(r: Pick<ReportSummary, "framesAnalysed" | "framesKept">): number | null {
  return r.framesAnalysed > 0 ? Math.min(1, r.framesKept / r.framesAnalysed) : null;
}

/** "Based on 3 of 4 views". */
export function overallCaption(r: Pick<ReportSummary, "sqiViews">): string {
  return r.sqiViews === 0 ? "Unavailable" : `Mean of ${r.sqiViews} of ${REPORT_VIEWS.length} views`;
}

export function sqiText(sqi: number | null): string {
  return sqi === null ? "Unavailable" : String(sqi);
}

/** Signed degrees with one decimal; values that round to zero read +0.0 without a sign flip artefact. */
export function formatDeg(deg: number): string {
  const r = Math.round(deg * 10) / 10;
  const v = Object.is(r, -0) || r === 0 ? 0 : r;
  return `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toFixed(1)}°`;
}

export interface TiltNumbers {
  /** Roll in degrees, as given. */
  degrees: number;
  /** Radians. */
  radians: number;
  /** Unit gravity components in the image plane: gx = sin(theta), gy = cos(theta). */
  gx: number;
  gy: number;
  thetaLabel: string;
  sinLabel: string;
  cosLabel: string;
}

const signed3 = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return (r === 0 ? 0 : r).toFixed(3);
};

/** The sin/cos numbers shown in the triangle. Null for a missing or non-finite roll. */
export function tiltNumbers(deg: number | null): TiltNumbers | null {
  if (deg === null || !Number.isFinite(deg)) return null;
  const radians = (deg * Math.PI) / 180;
  const gx = Math.sin(radians);
  const gy = Math.cos(radians);
  return { degrees: deg, radians, gx, gy, thetaLabel: formatDeg(deg), sinLabel: signed3(gx), cosLabel: signed3(gy) };
}

/** Fixed generic coordinates for the angle illustration (NOT patient data). */
export const ILLUSTRATION_POINTS = { a: { x: 0, y: 0 }, b: { x: 12, y: 5 } } as const;

export function illustrationAngle() {
  const dx = ILLUSTRATION_POINTS.b.x - ILLUSTRATION_POINTS.a.x;
  const dy = ILLUSTRATION_POINTS.b.y - ILLUSTRATION_POINTS.a.y;
  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { dx, dy, degrees, label: `${degrees.toFixed(1)}°` };
}

/** Linear tween helper with ease-out cubic; progress clamped to 0..1. */
export function easeValue(from: number, to: number, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  const e = 1 - Math.pow(1 - p, 3);
  return from + (to - from) * e;
}

/** Next card index, looping. */
export function nextIndex(i: number, n: number): number {
  return n <= 0 ? 0 : (i + 1) % n;
}
