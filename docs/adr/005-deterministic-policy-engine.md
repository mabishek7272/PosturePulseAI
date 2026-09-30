# ADR-005: Only a deterministic rule engine drives safety-relevant decisions

## Status
Accepted (Phase 2/3 engineering scaffolding)

## Context
Phase 3 adds movement-phase classification (`services/ml-service/app/movement/`,
TCN and ST-GCN architectures) alongside the existing rule-based safety state
machine (`services/backend-api/src/safety/safety-state-machine.ts`). Neither
model has any labeled training data in this sandbox — `train_entry_point.py`
is a real, runnable training CLI, but no checkpoint has ever been fit to real
movement-phase labels. Their forward-pass output is architecturally real
(genuine tensor math over genuine joint-angle features) but statistically
meaningless: randomly-initialized weights predict nothing.

## Decision
Only `services/backend-api/src/policy/policy-engine.service.ts` — a
deterministic comparison of clinician-set `targetJointAngles` +
`toleranceDegrees` + `repRange`, via `deviation-detector.service.ts` and
`rep-counter.service.ts` — is permitted to emit a safety-relevant
`DecisionEvent` (`cue`, `escalate_review`) or drive a `SafetyService`
transition.

The ST-GCN/TCN pipeline (`movement-window-buffer.service.ts` →
ml-service `/internal/movement-window`) produces a separate
`MovementPhaseEvent`, used only for descriptive phase-labeling and exposure
analytics. Its schema hard-codes `validated: {"const": false}`
(`packages/schemas/src/movement-phase-event.schema.json`), and
`movement_window_service.py` additionally sets `validated=False` in code —
belt-and-suspenders, not reliant on the schema constraint alone.

This is enforced **structurally**, not just by comment or code review:
`movement-window-buffer.service.ts` and `movement.module.ts` never import
`SafetyService` or `PolicyModule`. A future change that tries to wire
movement-phase predictions into a safety decision would have to add that
import back — a visible, reviewable diff, not a silent behavior change deep
inside an existing call.

## Rationale
Safety rules outranking AI/ML output is a non-negotiable rule for this
project (`CLAUDE.md` rule 2). An untrained model producing a `cue` or
`escalate_review` would be indistinguishable, from the outside, from a real
clinical judgment — but would in fact be noise. Keeping the safety path
100% deterministic and rule-based means every `cue` this system ever emits
traces to a clinician-authored target angle/tolerance/rep-range, not a
statistical artifact.

## Follow-up
Once a real movement-phase dataset and labeled training run exist, a
follow-up ADR should define exactly what evidentiary bar (validation
accuracy, clinician sign-off, per-protocol scope) a trained model would need
to clear before its output is even eligible to *inform* (never
unilaterally drive) a policy-engine decision. Until then, do not relax the
`validated: false` constraint or add a `SafetyService`/`PolicyModule`
import to the movement module.
