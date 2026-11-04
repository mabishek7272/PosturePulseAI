/**
 * Narrows `T | undefined` to `T`, or throws saying which invariant was broken.
 *
 * Exists for `noUncheckedIndexedAccess`. Under it, `arr[i]` is typed
 * `T | undefined` even where an earlier length check proves it present, and the
 * cheap ways out are both wrong in a measurement path:
 *
 * - `arr[i]!` silences the compiler and, if the invariant is ever broken,
 *   carries `undefined` forward into arithmetic, where it surfaces as `NaN`
 *   several calls later with no hint of where it came from.
 * - `arr[i] ?? 0` is worse: it MANUFACTURES a value. A frame time, a gravity
 *   component or a landmark coordinate of `0` is a plausible reading, so a
 *   broken invariant would produce a confident wrong number rather than a
 *   failure (CLAUDE.md rule 3: never fabricate a measurement).
 *
 * This throws at the point the assumption failed, with the reason the caller
 * believed it held. Use it only where a preceding check really does establish
 * the bound; where `undefined` is a legitimate outcome (a keypoint that was not
 * detected), handle that case explicitly instead.
 */
export function required<T>(value: T | undefined | null, invariant: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Invariant broken: ${invariant}`);
  }
  return value;
}

/**
 * Reads `buf[i]` from a numeric buffer; an out-of-range index is `NaN`.
 *
 * For the flat coordinate and score buffers in the capture code
 * (`[x0, y0, x1, y1, ...]`, with `-1` meaning "not seen"), where an
 * out-of-range read used to be `undefined` and the surrounding code was written
 * against exactly what `undefined` does in JavaScript:
 *
 * - `undefined >= 0` is `false`, so a missing point reads as "not seen", and
 *   `!(scores[i] >= MIN)` reads a missing score as low-confidence;
 * - arithmetic on `undefined` is `NaN`, which then propagates.
 *
 * `NaN` behaves identically on both counts, so swapping `buf[i]` for
 * `sample(buf, i)` changes NO behaviour - which is the point of using it here
 * and `required` elsewhere. And it is `NaN` rather than `0` on purpose: a
 * defaulted `0` is a plausible coordinate, which would turn a broken index into
 * a confident wrong number instead of a visibly missing one.
 */
export function sample(buf: ArrayLike<number>, i: number): number {
  return buf[i] ?? Number.NaN;
}
