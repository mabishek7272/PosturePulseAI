import type { SessionSummary } from "../api/sessions-list";
import { daysAgo } from "./homeData";

export type TrendRange = "12w" | "6m" | "all";

export const RANGE_OPTIONS = [
  { value: "12w", label: "12w" },
  { value: "6m", label: "6m" },
  { value: "all", label: "All" },
] as const;

const MAX_ALL_WEEKS = 156;

/** Number of weekly buckets for a range. "all" spans back to the oldest session (min 2). */
export function rangeWeeks(range: TrendRange, sessions: SessionSummary[], now: Date): number {
  if (range === "12w") return 12;
  if (range === "6m") return 26;
  let oldest = 0;
  for (const s of sessions) {
    const n = daysAgo(s.createdAt, now);
    if (n > oldest) oldest = n;
  }
  return Math.min(MAX_ALL_WEEKS, Math.max(2, Math.floor(oldest / 7) + 1));
}

/**
 * Assessments per rolling 7-day bucket, oldest first; the last bucket is the
 * 7 days ending today. Sessions outside the range or with bad dates are ignored.
 */
export function weeklyCounts(sessions: SessionSummary[], now: Date, weeks: number): number[] {
  const out = new Array<number>(weeks).fill(0);
  for (const s of sessions) {
    const n = daysAgo(s.createdAt, now);
    if (!(n >= 0)) continue;
    const bucket = Math.floor(n / 7);
    if (bucket < weeks) out[weeks - 1 - bucket] += 1;
  }
  return out;
}

/** Sessions whose age in whole days is in [fromDay, toDay). 0 = today. */
export function countInWindow(sessions: SessionSummary[], now: Date, fromDay: number, toDay: number): number {
  let c = 0;
  for (const s of sessions) {
    const n = daysAgo(s.createdAt, now);
    if (n >= fromDay && n < toDay) c += 1;
  }
  return c;
}

export interface Delta {
  direction: "up" | "down" | "flat";
  text: string;
}

/** Neutral, factual comparison wording ("2 more than last week"). */
export function deltaCaption(current: number, previous: number, reference: string): Delta {
  const diff = current - previous;
  if (diff === 0) return { direction: "flat", text: `Same as ${reference}` };
  const n = Math.abs(diff);
  return diff > 0
    ? { direction: "up", text: `${n} more than ${reference}` }
    : { direction: "down", text: `${n} fewer than ${reference}` };
}

export interface Pt {
  x: number;
  y: number;
}

export const CHART = { width: 300, height: 120, x0: 8, x1: 292, yTop: 30, yBase: 90 } as const;

/** Map counts onto the design's 300x120 viewBox: zero on the lowest gridline, the peak at y=30. */
export function chartPoints(counts: number[]): Pt[] {
  const max = Math.max(1, ...counts);
  const n = counts.length;
  return counts.map((c, i) => ({
    x: n === 1 ? CHART.x1 : CHART.x0 + (i * (CHART.x1 - CHART.x0)) / (n - 1),
    y: CHART.yBase - (c / max) * (CHART.yBase - CHART.yTop),
  }));
}

const r = (v: number) => Math.round(v * 100) / 100;

export function linePath(pts: Pt[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${r(p.x)} ${r(p.y)}`).join(" ");
}

export function areaPath(pts: Pt[]): string {
  if (pts.length === 0) return "";
  const last = pts[pts.length - 1];
  return `${linePath(pts)} L${r(last.x)} ${CHART.height} L${r(pts[0].x)} ${CHART.height} Z`;
}

export function pathLength(pts: Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return Math.ceil(len) + 1;
}

/** Up to four evenly spaced x-axis labels ("12w ago" ... "This week"). */
export function axisLabels(weeks: number): string[] {
  const idx = Array.from(new Set([0, 1, 2, 3].map((k) => Math.round((k * (weeks - 1)) / 3))));
  return idx.map((i) => {
    const ago = weeks - 1 - i;
    return ago === 0 ? "This week" : `${ago}w ago`;
  });
}
