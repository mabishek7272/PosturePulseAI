// Resolves the interpreter that runs codegen/generate-python.py.
//
// Both callers (package.json's `generate` script, via run-python.mjs, and
// check.mjs) go through here so the interpreter is decided in exactly one place.
//
// Why not a bare `python3`: generate-python.py shells out to
// `sys.executable -m datamodel_code_generator`, so it needs an interpreter that
// has that package. It is build-time-only tooling, deliberately kept out of
// services/ml-service's runtime dependency set, so it lives in a venv beside the
// schemas it generates (packages/schemas/requirements-codegen.txt).
//
// Before this existed, a missing dependency surfaced as a Python traceback from
// inside datamodel_code_generator with no indication of what to install - so the
// error path below is the point of the module as much as the happy path is.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

const SETUP = [
  "The schema codegen venv is missing or incomplete.",
  "",
  "  cd packages/schemas",
  "  python3.12 -m venv .venv            # 3.11 or 3.12; 3.14 is newer than the pin supports",
  "  .venv/bin/pip install -r requirements-codegen.txt",
  "",
  "Then re-run `npm run schemas:generate` (or `schemas:check`) from the repo root.",
  "Set BEAIVE_SCHEMAS_PYTHON to use a different interpreter instead.",
].join("\n");

/**
 * Absolute path to the Python interpreter for schema codegen.
 * Throws with setup instructions rather than letting a missing dependency
 * surface as an opaque traceback from the generator.
 */
export function pythonBin() {
  const override = process.env.BEAIVE_SCHEMAS_PYTHON;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`BEAIVE_SCHEMAS_PYTHON points at ${override}, which does not exist.`);
    }
    return override;
  }

  // POSIX layout first, then the Windows one, so a checkout on either works.
  for (const rel of [path.join(".venv", "bin", "python"), path.join(".venv", "Scripts", "python.exe")]) {
    const candidate = path.join(ROOT, rel);
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(SETUP);
}
