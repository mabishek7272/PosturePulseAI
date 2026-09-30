#!/bin/bash
# Regenerates CycloneDX SBOMs for all three services into docs/regulatory/sbom/.
# See docs/regulatory/sbom-process.md for the scoping caveat on the
# ml-service SBOM (this sandbox has no per-service Python virtualenv).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== backend-api =="
(cd services/backend-api && npx --yes @cyclonedx/cyclonedx-npm \
  --output-format json --output-file ../../docs/regulatory/sbom/backend-api.cdx.json)

echo "== clinician-web =="
(cd apps/clinician-web && npx --yes @cyclonedx/cyclonedx-npm \
  --output-format json --output-file ../../docs/regulatory/sbom/clinician-web.cdx.json)

echo "== ml-service =="
if ! command -v cyclonedx-py >/dev/null 2>&1; then
  echo "cyclonedx-py not found - run: pip install cyclonedx-bom" >&2
  exit 1
fi
(cd services/ml-service && cyclonedx-py environment \
  --output-format json --output-file ../../docs/regulatory/sbom/ml-service.cdx.json)

echo "Done. See docs/regulatory/sbom-process.md."
