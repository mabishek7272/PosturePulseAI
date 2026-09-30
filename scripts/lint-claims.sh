#!/usr/bin/env bash
# Grep-based claims/governance lint: fails if banned clinical-claim language appears
# outside governance documentation (docs/, and the root README/CLAUDE meta-files,
# which discuss the policy itself rather than asserting a clinical claim).
# See docs/claims-and-scope.md for the authoritative list and rationale.
set -euo pipefail

cd "$(dirname "$0")/.."

BANNED_PATTERN='diagnos|clinically validated|medically safe|cures|prevents injury|treats [a-z]+ disease'

EXCLUDE_DIRS=(
  "./docs"
  "./.git"
  "./node_modules"
  "*/node_modules/*"
  "./services/*/node_modules"
  "*/dist/*"
  "*/generated/*"
  "*/.venv/*"
)

# Root-level meta-documentation that discusses the claims policy itself (points
# readers at docs/claims-and-scope.md, states the policy as a rule) rather than
# making a user-facing clinical claim. Kept separate from EXCLUDE_DIRS since these
# are files, not directories.
EXCLUDE_FILES=(
  "./README.md"
  "./CLAUDE.md"
)

PRUNE_ARGS=()
for d in "${EXCLUDE_DIRS[@]}"; do
  PRUNE_ARGS+=(-path "$d" -o)
done

FILE_FILTER_ARGS=()
for f in "${EXCLUDE_FILES[@]}"; do
  FILE_FILTER_ARGS+=(-not -path "$f")
done

# Explicitly negated disclaimer phrasing is the CORRECT anti-claim language
# (e.g. a UI string saying "not a diagnosis", or a DraftBadge reading "NOT
# CLINICALLY VALIDATED") - it is what docs/claims-and-scope.md asks for, not a
# violation of it. Filtered out of the candidate matches below rather than
# excluded by file, since these appear inline in ordinary UI/doc-comment code.
SAFE_NEGATED_PATTERN='not a diagnosis|not clinically validated'

MATCHES=$(find . \( "${PRUNE_ARGS[@]}" -false \) -prune -o -type f \
  \( -name '*.md' -o -name '*.ts' -o -name '*.tsx' -o -name '*.py' -o -name '*.swift' -o -name '*.json' \) \
  "${FILE_FILTER_ARGS[@]}" \
  -print0 | xargs -0 grep -inE "$BANNED_PATTERN" 2>/dev/null | grep -viE "$SAFE_NEGATED_PATTERN" || true)

if [ -n "$MATCHES" ]; then
  echo "Claims lint FAILED - banned clinical-claim language found outside docs/:"
  echo "$MATCHES"
  echo
  echo "See docs/claims-and-scope.md. If this is a false positive (e.g. discussing the policy itself), adjust the pattern or move the text into docs/."
  exit 1
fi

echo "Claims lint passed - no banned clinical-claim language found outside docs/."
