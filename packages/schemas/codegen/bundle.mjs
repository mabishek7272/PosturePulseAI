import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import $RefParser from "@apidevtools/json-schema-ref-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SRC_DIR = path.join(__dirname, "..", "src");

// common.schema.json holds shared $defs only - never emitted as a standalone record.
const NON_RECORD_FILES = new Set(["common.schema.json"]);

/**
 * Loads every *.schema.json in src/, dereferences $refs (so downstream codegen
 * tools that don't do cross-file resolution get a single self-contained document
 * per record), and returns [{ name, filePath, schema }] sorted by name.
 */
export async function loadAndDereferenceSchemas() {
  const files = (await readdir(SRC_DIR)).filter(
    (f) => f.endsWith(".schema.json") && !NON_RECORD_FILES.has(f)
  );

  const results = [];
  for (const file of files.sort()) {
    const filePath = path.join(SRC_DIR, file);
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    const dereferenced = await $RefParser.dereference(filePath, structuredCloneSafe(raw), {
      dereference: { circular: false },
    });
    const name = file.replace(/\.schema\.json$/, "");
    results.push({ name, filePath, schema: dereferenced });
  }
  return results;
}

// json-schema-ref-parser mutates its input in place; pass a fresh clone so callers
// can safely reuse the raw parsed object elsewhere if needed.
function structuredCloneSafe(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export async function writeBundledJson(outDir) {
  await mkdir(outDir, { recursive: true });
  const schemas = await loadAndDereferenceSchemas();
  for (const { name, schema } of schemas) {
    await writeFile(
      path.join(outDir, `${name}.schema.json`),
      JSON.stringify(schema, null, 2) + "\n",
      "utf-8"
    );
  }
  return schemas;
}
