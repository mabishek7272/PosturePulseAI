import { computePosition, type Position, type ReferenceBounds } from "./report-position";

const range: ReferenceBounds = { lo: 0, hi: 5 };
const point: ReferenceBounds = { lo: 0, hi: 0 };

type Row = [string, { value: number; uncertainty: number } | null, ReferenceBounds | null, Position];

const TABLE: Row[] = [
  // Range reference [0, 5]
  ["range: interval strictly inside", { value: 2, uncertainty: 1 }, range, "within"],
  ["range: zero-width interval on the lower bound", { value: 0, uncertainty: 0 }, range, "within"],
  ["range: zero-width interval on the upper bound", { value: 5, uncertainty: 0 }, range, "within"],
  ["range: interval touching the lower bound from inside", { value: 0.5, uncertainty: 0.5 }, range, "within"],
  ["range: interval touching the upper bound from inside", { value: 4.5, uncertainty: 0.5 }, range, "within"],
  ["range: interval equal to the range", { value: 2.5, uncertainty: 2.5 }, range, "within"],
  ["range: entirely below", { value: -2, uncertainty: 1 }, range, "below"],
  ["range: entirely below by a hair", { value: -1.0001, uncertainty: 1 }, range, "below"],
  ["range: upper end touching the lower bound", { value: -1, uncertainty: 1 }, range, "indeterminate"],
  ["range: straddling the lower bound", { value: 0, uncertainty: 1 }, range, "indeterminate"],
  ["range: entirely above", { value: 7, uncertainty: 1 }, range, "above"],
  ["range: entirely above by a hair", { value: 6.0001, uncertainty: 1 }, range, "above"],
  ["range: lower end touching the upper bound", { value: 6, uncertainty: 1 }, range, "indeterminate"],
  ["range: straddling the upper bound", { value: 4, uncertainty: 2 }, range, "indeterminate"],
  ["range: interval wider than the whole range", { value: 2.5, uncertainty: 10 }, range, "indeterminate"],
  // Single-value reference 0
  ["value: exact match with zero uncertainty", { value: 0, uncertainty: 0 }, point, "within"],
  ["value: interval contains the value", { value: 0, uncertainty: 1 }, point, "indeterminate"],
  ["value: interval ends exactly on the value (above)", { value: 1, uncertainty: 1 }, point, "indeterminate"],
  ["value: interval ends exactly on the value (below)", { value: -1, uncertainty: 1 }, point, "indeterminate"],
  ["value: entirely above", { value: 2, uncertainty: 1 }, point, "above"],
  ["value: entirely below", { value: -2, uncertainty: 0.5 }, point, "below"],
  ["value: tiny offset, zero uncertainty, above", { value: 0.0001, uncertainty: 0 }, point, "above"],
  ["value: tiny offset, zero uncertainty, below", { value: -0.0001, uncertainty: 0 }, point, "below"],
  // No reference / no estimate
  ["no reference", { value: 2, uncertainty: 1 }, null, "no_reference"],
  ["no estimate, reference present", null, range, "not_applicable"],
  ["no estimate, no reference", null, null, "not_applicable"],
];

describe("computePosition", () => {
  it.each(TABLE)("%s", (_name, estimate, reference, expected) => {
    expect(computePosition(estimate, reference)).toBe(expected);
  });

  it("treats a negative uncertainty as invalid input", () => {
    expect(() => computePosition({ value: 1, uncertainty: -1 }, point)).toThrow();
  });

  it("treats a non-finite value as invalid input", () => {
    expect(() => computePosition({ value: Number.NaN, uncertainty: 1 }, point)).toThrow();
  });
});
