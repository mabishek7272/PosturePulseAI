// Thin wrapper so package.json's `generate` script and check.mjs resolve the
// codegen interpreter the same way (see python-bin.mjs). Any arguments are
// forwarded to generate-python.py, which takes an optional output directory.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pythonBin } from "./python-bin.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

try {
  execFileSync(pythonBin(), [path.join(HERE, "generate-python.py"), ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: path.join(HERE, ".."),
  });
} catch (error) {
  // execFileSync already streamed the child's output; printing the whole Node
  // stack on top of it just buries the real message.
  console.error(error.message);
  process.exit(typeof error.status === "number" ? error.status : 1);
}
