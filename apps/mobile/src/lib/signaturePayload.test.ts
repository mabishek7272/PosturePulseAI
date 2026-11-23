import { buildSignaturePayload, MAX_SIGNATURE_PATH_CHARS, MAX_SIGNATURE_PATHS, MAX_SIGNATURE_TOTAL_CHARS } from "./signaturePayload";
import type { Stroke } from "./signature";

const PATTERN = /^[ML0-9.\- ]+$/; // the server's accepted alphabet

const line = (n: number): Stroke => Array.from({ length: n }, (_, i) => ({ x: i * 1.234, y: 10 + Math.sin(i) * 7.77 }));

describe("buildSignaturePayload", () => {
  it("writes each stroke as a move then lines, rounded to one decimal", () => {
    const payload = buildSignaturePayload([[{ x: 1.26, y: 2 }, { x: 3, y: 4.44 }]], 300, 150)!;
    expect(payload).toEqual({ width: 300, height: 150, paths: ["M 1.3 2 L 3 4.4"] });
  });

  it("only ever produces characters the server accepts (no curves, no script)", () => {
    const payload = buildSignaturePayload([line(30), line(12)], 320, 150)!;
    expect(payload.paths.every((p) => PATTERN.test(p))).toBe(true);
  });

  it("returns null when nothing was drawn, or the box is not real", () => {
    expect(buildSignaturePayload([], 300, 150)).toBeNull();
    expect(buildSignaturePayload([[]], 300, 150)).toBeNull();
    expect(buildSignaturePayload([line(5)], 0, 150)).toBeNull();
    expect(buildSignaturePayload([line(5)], 300, Number.NaN)).toBeNull();
  });

  it("turns a single tap into a drawable dot", () => {
    const payload = buildSignaturePayload([[{ x: 5, y: 5 }]], 300, 150)!;
    expect(payload.paths[0]).toBe("M 5 5 L 5.1 5");
  });

  it("thins a very long drawing until it fits the limits, keeping every stroke and the last point", () => {
    const long = line(3000);
    const payload = buildSignaturePayload([long, long], 300, 150)!;
    expect(payload.paths).toHaveLength(2);
    expect(payload.paths.every((p) => p.length <= MAX_SIGNATURE_PATH_CHARS)).toBe(true);
    expect(payload.paths.reduce((n, p) => n + p.length, 0)).toBeLessThanOrEqual(MAX_SIGNATURE_TOTAL_CHARS);
    const lastPoint = long.at(-1)!;
    const rounded = (n: number) => String(Math.round(n * 10) / 10);
    expect(payload.paths[0]!.endsWith(`L ${rounded(lastPoint.x)} ${rounded(lastPoint.y)}`)).toBe(true);
  });

  it("refuses more strokes than the server allows rather than dropping some", () => {
    expect(buildSignaturePayload(Array.from({ length: MAX_SIGNATURE_PATHS + 1 }, () => line(4)), 300, 150)).toBeNull();
    expect(buildSignaturePayload(Array.from({ length: MAX_SIGNATURE_PATHS }, () => line(4)), 300, 150)).not.toBeNull();
  });
});
