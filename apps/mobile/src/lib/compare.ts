import type { MetricResult } from "../api/events";
import { formatResult, metricLabel, resultKind, unitSuffix } from "./results";

/**
 * Pure maths for comparing two scans of the same patient. Nothing here is a
 * score or a judgement: it reports numbers and whether the difference exceeds
 * the combined reported uncertainty. A missing uncertainty is never treated as 0.
 */

export interface ComparedMetric {
  key: string;
  label: string;
  unit?: string;
  a: number;
  b: number;
  /** Null when the scan did not report a finite uncertainty. */
  uA: number | null;
  uB: number | null;
  mean: number;
  /** Sample standard deviation, n = 2: |A-B| / sqrt(2). */
  deviation: number;
  /** Signed, B - A (later minus earlier). */
  difference: number;
  /** sqrt(uA^2 + uB^2), null if either uncertainty is not reported. */
  combinedUncertainty: number | null;
  /** True/false against the combined uncertainty; null when it cannot be judged. */
  withinCombined: boolean | null;
}

export interface NotCompared {
  key: string;
  label: string;
  /** Explicit reason text, one line per scan that lacks an estimate. */
  reasons: string[];
}

export interface Comparison {
  compared: ComparedMetric[];
  notCompared: NotCompared[];
}

const EPS = 1e-9;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const keyOf = (r: Pick<MetricResult, "metricKey" | "side">) => `${r.metricKey}|${r.side ?? ""}`;

export function compareValues(
  a: number, uA: number | null | undefined, b: number, uB: number | null | undefined
): Omit<ComparedMetric, "key" | "label" | "unit"> {
  const ua = finite(uA) ? Math.abs(uA) : null;
  const ub = finite(uB) ? Math.abs(uB) : null;
  const difference = b - a;
  const combinedUncertainty = ua !== null && ub !== null ? Math.sqrt(ua * ua + ub * ub) : null;
  return {
    a, b, uA: ua, uB: ub,
    mean: (a + b) / 2,
    deviation: Math.abs(a - b) / Math.sqrt(2),
    difference,
    combinedUncertainty,
    withinCombined: combinedUncertainty === null ? null : Math.abs(difference) <= combinedUncertainty + EPS,
  };
}

/** First entry per metric key; an estimate wins over an unmeasured entry. */
function index(list: MetricResult[]): Map<string, MetricResult> {
  const m = new Map<string, MetricResult>();
  for (const r of list) {
    const k = keyOf(r);
    const prev = m.get(k);
    if (!prev || (!prev.estimate && r.estimate)) m.set(k, r);
  }
  return m;
}

/** A = earlier scan, B = later scan. Order follows scan B's metric order, then A-only metrics. */
export function compareScans(earlier: MetricResult[], later: MetricResult[]): Comparison {
  const ia = index(earlier);
  const ib = index(later);
  const keys = [...ib.keys(), ...[...ia.keys()].filter((k) => !ib.has(k))];
  const compared: ComparedMetric[] = [];
  const notCompared: NotCompared[] = [];
  for (const key of keys) {
    const ra = ia.get(key);
    const rb = ib.get(key);
    const label = metricLabel((rb ?? ra)!);
    if (ra && rb && resultKind(ra) === "estimate" && resultKind(rb) === "estimate" && finite(ra.estimate!.value) && finite(rb.estimate!.value)) {
      if (ra.unit && rb.unit && ra.unit !== rb.unit) {
        notCompared.push({ key, label, reasons: [`Units differ between scans (${ra.unit} and ${rb.unit})`] });
        continue;
      }
      compared.push({
        key, label, unit: rb.unit ?? ra.unit,
        ...compareValues(ra.estimate!.value, ra.estimate!.uncertainty, rb.estimate!.value, rb.estimate!.uncertainty),
      });
      continue;
    }
    const reasons: string[] = [];
    const why = (r: MetricResult | undefined, name: string) => {
      if (!r) return reasons.push(`${name}: not recorded`);
      if (resultKind(r) !== "estimate") return reasons.push(`${name}: ${formatResult(r)}`);
    };
    why(ra, "Earlier scan");
    why(rb, "Later scan");
    notCompared.push({ key, label, reasons });
  }
  return { compared, notCompared };
}

const fmt = (n: number, unit?: string, signed = true) => `${signed && n >= 0 ? "+" : ""}${n.toFixed(1)}${unitSuffix(unit)}`;

export const formatCompareValue = (n: number, unit?: string) => fmt(n, unit);
export const formatCompareUnsigned = (n: number, unit?: string) => fmt(n, unit, false);
export const formatUncertainty = (u: number | null) => (u === null ? "uncertainty not reported" : `±${u.toFixed(1)}`);

/** Neutral statement; no improved/worsened/normal/abnormal wording. */
export function withinStatement(c: Pick<ComparedMetric, "withinCombined">): string {
  if (c.withinCombined === null) return "Uncertainty not reported, so the difference cannot be compared with it";
  return c.withinCombined ? "Difference is within the combined uncertainty" : "Difference is larger than the combined uncertainty";
}

export const COMPARE_CAPTION = "With two scans the deviation is only indicative.";
