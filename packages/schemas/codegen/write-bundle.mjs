// CLI wrapper: node write-bundle.mjs <outDir>
// Writes one dereferenced *.schema.json per record into <outDir>, for consumption
// by tools (e.g. datamodel-code-generator) that don't resolve cross-file $refs.
import { writeBundledJson } from "./bundle.mjs";

const outDir = process.argv[2];
if (!outDir) {
  console.error("Usage: node write-bundle.mjs <outDir>");
  process.exit(1);
}

writeBundledJson(outDir)
  .then((schemas) => {
    console.log(`Wrote ${schemas.length} bundled schema(s) to ${outDir}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
