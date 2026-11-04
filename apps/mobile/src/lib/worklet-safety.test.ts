import * as fs from "node:fs";
import * as path from "node:path";

/**
 * A Reanimated / vision-camera worklet cannot synchronously call a plain
 * function from another module. Doing so type-checks, passes every Jest test
 * (where 'worklet' is just a string statement), and throws on device: "Tried to
 * synchronously call a non-worklet function on the UI thread".
 *
 * `noUncheckedIndexedAccess` made this a live risk, because the natural fix for
 * an indexed read inside `pose-overlay.ts` is the shared `sample` helper - which
 * would break the camera frame callback with no signal anywhere in CI.
 * `pose-overlay.ts` therefore carries its OWN `sample` with a 'worklet'
 * directive, and `capture.tsx` keeps a plain `if` inside its `onFrame` worklet
 * instead of calling `required`.
 *
 * What matters is a CALL from inside a worklet body, not an import: capture.tsx
 * legitimately imports `required` for its component code.
 */
const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

/** Bodies of every function that carries a 'worklet' directive, brace-matched. */
export function workletBodies(source: string): string[] {
  const bodies: string[] = [];
  const directive = /['"]worklet['"]/g;
  for (let m = directive.exec(source); m; m = directive.exec(source)) {
    // Walk back to the unmatched '{' that opens the function body.
    let depth = 0;
    let open = -1;
    for (let i = m.index - 1; i >= 0; i--) {
      const ch = source[i];
      if (ch === "}") depth++;
      else if (ch === "{") {
        if (depth === 0) {
          open = i;
          break;
        }
        depth--;
      }
    }
    if (open < 0) continue;
    // Forward to its matching '}'.
    depth = 0;
    for (let i = open; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        bodies.push(source.slice(open, i + 1));
        break;
      }
    }
  }
  return bodies;
}

const files = sourceFiles(SRC).map((f) => ({ file: f, source: fs.readFileSync(f, "utf8") }));
const workletFiles = files.filter(({ source }) => /['"]worklet['"]/.test(source));

describe("worklet safety", () => {
  it("finds the worklet files, so this cannot pass by scanning nothing", () => {
    const names = workletFiles.map(({ file }) => path.basename(file));
    expect(names).toContain("pose-overlay.ts");
    expect(names).toContain("capture.tsx");
    expect(workletFiles.flatMap(({ source }) => workletBodies(source)).length).toBeGreaterThan(8);
  });

  it.each(workletFiles.map(({ file, source }) => [path.relative(SRC, file), source]))(
    "%s: no worklet body calls the shared required()",
    (_name, source) => {
      for (const body of workletBodies(source as string)) {
        expect(body).not.toMatch(/\brequired\s*\(/);
      }
    }
  );

  it.each(workletFiles.map(({ file, source }) => [path.relative(SRC, file), source]))(
    "%s: a worklet may call sample() only if the file defines its own worklet sample()",
    (_name, source) => {
      const src = source as string;
      const importsShared = /import\s*\{[^}]*\bsample\b[^}]*\}\s*from\s*["'][^"']*required["']/.test(src);
      const definesOwn = /function sample\([^)]*\)[^{]*\{\s*['"]worklet['"]/.test(src);
      const callsInWorklet = workletBodies(src).some((b) => /\bsample\s*\(/.test(b));
      if (callsInWorklet) {
        expect(importsShared).toBe(false);
        expect(definesOwn).toBe(true);
      }
    }
  );

  it("the brace matcher finds a body, and respects nesting", () => {
    const sample = "function a() { 'worklet'; if (x) { y(); } return required(1); }\nfunction b() { return 2; }";
    const bodies = workletBodies(sample);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("required(1)");
    expect(bodies[0]).not.toContain("function b");
  });
});
