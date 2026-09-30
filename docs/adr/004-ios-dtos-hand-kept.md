# ADR-004: iOS DTOs hand-kept, not codegenned, in this phase

## Status
Accepted (Phase 0 / start of Phase 1)

## Context
`packages/schemas` already generates TypeScript and Python bindings from the
same JSON Schema source. The iOS client also consumes a subset of these
records (session state, quality flags, landmark arrays for overlay rendering).

## Decision
iOS DTOs (`apps/ios-client/Sources/Networking/DTOs/`) are hand-written Swift
structs in this phase, each with a comment pointing at the canonical schema
`$id`/version they mirror — not generated via a third codegen target (e.g.
quicktype).

## Rationale
Adding full Swift codegen from JSON Schema before the TS/Python pipeline is
proven (this is its first real usage) would add a third moving part to debug
at once. The iOS client in this phase only needs a handful of fields (session
id, quality-flag enum, landmark array, decision-event action) — the surface
area is small enough that hand-keeping is a bounded, reviewable risk, not an
open-ended one.

## Follow-up
Add Swift codegen (quicktype or similar) once the TS/Python codegen pipeline
has shipped a few real schema changes and proven itself. This is a deliberate
scope-limiting trade-off, not an oversight — do not "fix" it by silently
letting iOS DTOs drift; keep the schema-`$id` comment on every hand-written DTO
so drift is at least detectable by inspection until codegen exists.
