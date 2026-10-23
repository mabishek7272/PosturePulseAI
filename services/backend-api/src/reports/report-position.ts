/**
 * Where a measurement sits relative to its reference (ADR-015,
 * assessment-report.schema.json rows[].position).
 *
 * The estimate is the closed interval [value - uncertainty, value + uncertainty];
 * the reference is the closed interval [lo, hi] (a single-value reference has
 * lo = hi).
 *   - below / above: the whole estimate interval lies strictly outside the
 *     reference. An interval that only touches a bound is not outside it.
 *   - within: the whole estimate interval lies inside the reference.
 *   - indeterminate: anything else, i.e. the interval overlaps a bound. With a
 *     single-value reference this is every interval that contains the value
 *     unless the uncertainty is exactly 0.
 *   - no_reference: there is an estimate but no reference for this row.
 *   - not_applicable: there is no estimate (unsupported or not measurable).
 */
export type Position = "below" | "within" | "above" | "indeterminate" | "no_reference" | "not_applicable";

export interface ReferenceBounds {
  lo: number;
  hi: number;
}

export function computePosition(
  estimate: { value: number; uncertainty: number } | null,
  reference: ReferenceBounds | null
): Position {
  if (!estimate) return "not_applicable";
  const { value, uncertainty } = estimate;
  if (!Number.isFinite(value) || !Number.isFinite(uncertainty) || uncertainty < 0) {
    throw new Error(`Invalid estimate ${value} ± ${uncertainty}`);
  }
  if (!reference) return "no_reference";

  const low = value - uncertainty;
  const high = value + uncertainty;
  if (high < reference.lo) return "below";
  if (low > reference.hi) return "above";
  if (low >= reference.lo && high <= reference.hi) return "within";
  return "indeterminate";
}
