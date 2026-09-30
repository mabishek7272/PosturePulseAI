# CLAUDE.md

Guidance for Claude Code (or any agent) working in this repository.

## What this repo is

Phase 0 + start-of-Phase-1 scaffolding for beAIve, a clinician-supervised posture and
movement-assessment platform. Read `README.md` for the architecture overview and
`docs/claims-and-scope.md` before touching any user-facing copy, protocol data, or
documentation.

## Non-negotiable rules (from the product's PRD/TRD)

1. **Never imply a diagnosis, validated clinical accuracy, or a medically-meaningful
   score.** All exercise protocols in `protocols/` are drafts (`"status": "draft"`,
   `"clinicallyValidated": false`) until a clinical lead signs off — do not change
   those fields yourself.
2. **Safety rules outrank AI/ML output, always.** In `services/backend-api/src/safety`,
   a symptom report or contraindication must transition the session to `Pause`
   regardless of concurrent model confidence. Never weaken this precedence when
   touching the state machine.
3. **Never fabricate a measurement.** If pose quality, scale, or identity is
   insufficient (`services/ml-service/app/quality`), the pipeline must emit an
   explicit `unsupported` quality-gate flag and suppress any corrective cue — not
   silently omit the field or guess.
4. **Track provenance on every record.** Every schema in `packages/schemas/src` has a
   `version`; every emitted event should carry the model/adapter/calibration version
   that produced it (see `docs/traceability-matrix.md`).
5. **Schemas are generated, not hand-edited.** Edit `packages/schemas/src/*.schema.json`
   only; run `npm run schemas:generate` and commit the output. Do not hand-edit files
   under `packages/schemas/generated/`.

## Where things live

- Canonical data contracts: `packages/schemas/src/*.schema.json`
- Safety state machine: `services/backend-api/src/safety/safety-state-machine.ts`
- Quality gate: `services/ml-service/app/quality/quality_gate.py`
- Draft protocols: `protocols/*.json`
- Governance docs / hazard analysis / ADRs: `docs/`

## Before committing

- Run `npm run lint:claims` if you touched copy, docs, or protocol data.
- Run `npm run backend:test` if you touched `services/backend-api`.
- Run `pytest` inside `services/ml-service` if you touched the ML pipeline.
- If you changed a schema, run `npm run schemas:check` to confirm generated output is
  up to date.
