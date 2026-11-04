#!/usr/bin/env bash
# Grep-based claims/governance lint: fails if banned clinical-claim language appears
# outside governance documentation (docs/, and the root README/CLAUDE meta-files,
# which discuss the policy itself rather than asserting a clinical claim).
# See docs/claims-and-scope.md for the authoritative list and rationale.
set -euo pipefail

cd "$(dirname "$0")/.."

# `cures` is word-bounded because the match is case-insensitive and the bare
# substring hits ordinary identifiers - "SecureStore" contains "cureS". The
# boundary removes that false positive without weakening the rule: "cures back
# pain" and "cures injury" still match. The other terms stay unbounded on
# purpose, so "diagnos" catches diagnose/diagnosis/diagnostic alike.
#
# The second and third lines were added after an audit found that every one of
# these terms passed BOTH this lint and references/banned-phrases.json, while
# violating docs/claims-and-scope.md as written:
#
#   * "clinically verified" / "clinically proven" - a straight synonym evasion.
#     The original pattern matched the literal string "clinically validated", so
#     a one-word substitution defeated it entirely.
#   * "biomarker", "vestibular", "proprioce(ptive|ption)" - physiological and
#     neurological attribution. claims-and-scope.md's hard boundary is that video
#     "does not directly measure" physiology and that a video-inferred substitute
#     is never acceptable; these are Level D/E framing, well above the Level A
#     ceiling. "proprioce" is a stem so it catches both -ptive and -ption.
#   * "romberg", "de-cortication" - named clinical constructs and a neurological
#     lesion term. The hyphen is optional in the pattern because "De-Cortication"
#     and "decortication" are the same claim.
#   * "sub-degree" - an accuracy claim. ADR-018 states that "every posture number
#     this product produces is an unvalidated engineering estimate", and no
#     accuracy figure is evidenced by any completed study.
#
# TRADE-OFF, documented on purpose: "vestibular" and "proprioce" are banned as
# bare stems, not only in claim phrasings like "vestibular reliance". There are
# currently zero occurrences anywhere in the repo, so this costs nothing today,
# but a clinician-authored contraindication in protocols/*.json that names a
# vestibular condition WOULD trip it. That is the intended direction of failure
# (loud, with a documented escape hatch below) rather than a silent allowance.
# If it becomes a real nuisance, narrow these two to the claim forms
# "(vestibular|proprioceptive) (reliance|function|contribution|deficit)" rather
# than deleting them.
BANNED_PATTERN='diagnos|clinically validated|clinically verified|clinically proven'
BANNED_PATTERN+='|medically safe|\bcures\b|prevents injury|treats [a-z]+ disease'
BANNED_PATTERN+='|biomarker|sub-?degree|vestibular|proprioce|romberg|de-?cortic'

EXCLUDE_DIRS=(
  "./docs"
  "./.git"
  "./.claude"
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
#
# "Nothing is clinically validated" is the same disclaimer as "not clinically
# validated" and is exactly what claims-and-scope.md asks a document to say, but
# the original pattern only matched the "not ..." form - so the correct sentence
# failed the lint outside docs/. Both negation forms are now covered.
#
# Known weakness of filtering by LINE: a line carrying both a legitimate
# disclaimer and a real violation is suppressed. Left as-is rather than reworked,
# but worth knowing before trusting a clean run on prose-heavy files.
SAFE_NEGATED_PATTERN='not a diagnosis|not clinically validated'
SAFE_NEGATED_PATTERN+='|(nothing|none of (this|it|which)) is clinically validated'
SAFE_NEGATED_PATTERN+='|never clinically validated|not been clinically validated'
# The verb form of the same disclaimer. "It does not diagnose" is the sentence
# claims-and-scope.md wants a UI string or a doc to say; only the noun form
# ("not a diagnosis") was exempt before, so the correct verb phrasing failed.
SAFE_NEGATED_PATTERN+='|(does|do|will|can) not diagnose|never diagnoses'
SAFE_NEGATED_PATTERN+='|is not a diagnos|are not a diagnos|not diagnostic'

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
