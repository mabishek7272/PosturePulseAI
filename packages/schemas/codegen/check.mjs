// Regenerates TS + Python bindings into scratch directories (via the generators'
// output-dir override) and diffs them against the committed generated/ output.
// Fails (non-zero exit) on any drift, so a schema change can never be merged
// without its generated bindings. Runs in-place (not a copied tree) so it reuses
// the already-installed node_modules / Python environment.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pythonBin } from "./python-bin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Build artifacts that are not generator output. Python writes __pycache__ into
// generated/python/beaive_schemas the moment anything imports those modules (the
// ml-service tests do), and the freshly generated scratch copy has never been
// imported - so comparing them reported 22 phantom "out of date" entries and
// failed the check with no schema having changed. They are gitignored and never
// committed, so skipping them here compares generator output to generator output.
const IGNORED_ENTRIES = new Set(["__pycache__", ".DS_Store"]);
const IGNORED_SUFFIXES = [".pyc", ".pyo"];

function listFilesRecursive(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORED_ENTRIES.has(entry)) continue;
    if (IGNORED_SUFFIXES.some((suffix) => entry.endsWith(suffix))) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function diffDirs(committed, fresh) {
  const filesCommitted = listFilesRecursive(committed).map((f) => path.relative(committed, f)).sort();
  const filesFresh = listFilesRecursive(fresh).map((f) => path.relative(fresh, f)).sort();

  const mismatches = [];
  const setFresh = new Set(filesFresh);
  for (const rel of filesCommitted) {
    if (!setFresh.has(rel)) {
      mismatches.push(`missing in freshly generated output: ${rel}`);
      continue;
    }
    const a = readFileSync(path.join(committed, rel), "utf-8");
    const b = readFileSync(path.join(fresh, rel), "utf-8");
    if (a !== b) mismatches.push(`content differs: ${rel}`);
  }
  const setCommitted = new Set(filesCommitted);
  for (const rel of filesFresh) {
    if (!setCommitted.has(rel)) {
      mismatches.push(`extra file in freshly generated output (stale committed file?): ${rel}`);
    }
  }
  return mismatches;
}

const tmp = mkdtempSync(path.join(tmpdir(), "beaive-schemas-check-"));
try {
  const tmpTs = path.join(tmp, "ts");
  const tmpPy = path.join(tmp, "python");

  execFileSync("node", [path.join(ROOT, "codegen", "generate-ts.mjs"), tmpTs], {
    stdio: "inherit",
    cwd: ROOT,
  });
  execFileSync(pythonBin(), [path.join(ROOT, "codegen", "generate-python.py"), tmpPy], {
    stdio: "inherit",
    cwd: ROOT,
  });

  const mismatches = [
    ...diffDirs(path.join(ROOT, "generated", "ts", "src"), tmpTs),
    ...diffDirs(path.join(ROOT, "generated", "python", "beaive_schemas"), tmpPy),
  ];

  if (mismatches.length > 0) {
    console.error("Generated schema bindings are out of date. Run `npm run schemas:generate` and commit the result.");
    for (const m of mismatches) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log("Generated schema bindings are up to date.");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
