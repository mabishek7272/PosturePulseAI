import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";
import { loadAndDereferenceSchemas } from "./bundle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Optional CLI override (used by check.mjs to render into a scratch dir without
// touching the committed output or needing its own node_modules copy).
const OUT_DIR = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "..", "generated", "ts", "src");

function toPascalCase(kebab) {
  return kebab
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * json-schema-to-typescript cannot merge a sibling `allOf` whose entries are
 * pure `if/then` conditionals (they carry no `type`/`properties` to merge with
 * the enclosing object) and degenerates the whole node to `{[k: string]: unknown}`.
 * Those conditionals encode cross-field business rules (e.g. "action=cue requires
 * cuePayload") that are still fully enforced at runtime via ajv against the raw,
 * unstripped schema in packages/schemas/src - stripping them here only affects the
 * generated TypeScript *type*, not runtime validation.
 */
function stripConditionalOnlyAllOf(node) {
  if (Array.isArray(node)) {
    return node.map(stripConditionalOnlyAllOf);
  }
  if (node && typeof node === "object") {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "allOf" && Array.isArray(value)) {
        const kept = value
          .filter((entry) => !(entry && typeof entry === "object" && "if" in entry))
          .map(stripConditionalOnlyAllOf);
        if (kept.length > 0) out[key] = kept;
        continue;
      }
      out[key] = stripConditionalOnlyAllOf(value);
    }
    return out;
  }
  return node;
}

async function main() {
  const schemas = await loadAndDereferenceSchemas();

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const exportLines = [];
  for (const { name, schema } of schemas) {
    const typeName = toPascalCase(name);
    const ts = await compile(stripConditionalOnlyAllOf(schema), typeName, {
      bannerComment:
        "/* eslint-disable */\n/**\n * Generated from packages/schemas/src/" +
        name +
        ".schema.json - DO NOT EDIT BY HAND.\n * Run `npm run schemas:generate` to regenerate.\n */",
      additionalProperties: false,
    });
    const fileName = `${name}.ts`;
    await writeFile(path.join(OUT_DIR, fileName), ts, "utf-8");
    exportLines.push(`export * from "./${name}";`);
  }

  await writeFile(
    path.join(OUT_DIR, "index.ts"),
    "/* eslint-disable */\n// DO NOT EDIT BY HAND. Run `npm run schemas:generate` to regenerate.\n" +
      exportLines.join("\n") +
      "\n",
    "utf-8"
  );

  console.log(`Generated ${schemas.length} TypeScript modules into ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
