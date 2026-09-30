# ADR-002: JSON Schema as single source of truth, generated bindings committed

## Status
Accepted (Phase 0)

## Context
Canonical records (pose frames, quality flags, decision events, sessions,
protocols, …) must be identical in shape between the NestJS backend and the
Python ML service, and must be self-describing enough for a non-engineer
(clinical/regulatory reviewer) to read.

## Decision
`packages/schemas/src/*.schema.json` (JSON Schema, draft 2020-12) is the single
source of truth. `npm run schemas:generate` produces TypeScript
(`json-schema-to-typescript`) and Pydantic v2 (`datamodel-code-generator`)
bindings, which are **committed to the repo**, not generated purely at build
time. `npm run schemas:check` regenerates into a scratch directory and diffs
against the committed output, failing CI on drift.

## Rejected alternative
Hand-mirrored TypeScript + Pydantic types with only a contract test. Rejected
because it guarantees eventual drift — two humans editing two files
independently — and the contract test only catches the drift after the fact,
not before someone merges it.

## Consequence discovered during implementation
`json-schema-to-typescript` cannot merge a sibling `allOf` whose entries are pure
`if/then` conditionals (used here to encode cross-field business rules like
"action=cue requires cuePayload") — it degenerates the entire type to
`{[k: string]: unknown}`. Fixed by stripping conditional-only `allOf` entries
before TypeScript generation only (`stripConditionalOnlyAllOf` in
`codegen/generate-ts.mjs`); the raw, unstripped schema is still what ajv
validates at runtime (see `codegen/contract.test.mjs`), so the business rule is
still enforced — only the generated TypeScript *type* is simplified.
`datamodel-code-generator` (Python) does not have this problem; it silently
drops the conditional and keeps the base structure, which is an accepted
(documented) limitation on the Python side: the business rule is enforced by
ajv/runtime validation, not by the Pydantic model's type alone.

## Committed-output rationale
Committing generated output means a schema-change PR shows the generated
diff for human review in the same PR — relevant for a regulated-adjacent
product's audit trail — at the cost of needing the CI drift check.
