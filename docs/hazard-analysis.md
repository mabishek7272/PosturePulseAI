# Hazard analysis

Seeded verbatim from beAIve TRD §2.7 ("Requirements traceability and failure
controls"). Each hazard gets a `controlId` that a `QualityGateFlag` or
`DecisionEvent` instance can reference in its `rule.ruleId` or `evidence`, and that
`docs/traceability-matrix.md` maps to schema/model/protocol versions.

This is a design-time hazard analysis, not a completed ISO 14971 risk management
file. See `docs/study-charter-skeleton.md` and TRD §3.3 for what a real regulatory
submission additionally requires.

| controlId | Hazard or failure | Detection | Control and validation | Implemented where (this repo) |
|---|---|---|---|---|
| HZ-01 | Left/right swap, mirror, or identity switch | Orientation metadata, temporal consistency, subject check | Suppress side-specific cue; synthetic mirror and multi-person tests | `pose-landmark-frame.schema.json` (`personTrackId`); `ml-service/app/quality/quality_gate.py` (`identity_uncertain` reason) |
| HZ-02 | Monocular depth/scale error | Reprojection residual, depth coverage, known-size sanity check | Suppress distances/load claims; compare with motion capture/reference depth | `calibrated-joint-frame.schema.json` (`scaleValidated`, `calibrationRef`); `scale-calibration-record.schema.json`; `services/ml-service/app/geometry/scale_calibration.py` implements `subject_specific` only (ADR-008) — the other three enum methods remain unimplemented |
| HZ-03 | Occluded joint during lifting | Visibility/uncertainty and required-joint mask | No precise score; request view; obstruction tests | `pose-landmark-frame.schema.json` (`observationState: occluded` forces `position: null`); `quality-gate-flag.schema.json` (`occlusion` reason) |
| HZ-04 | AR anchor drift | World/object transform movement and plane confidence | Freeze overlay and recalibrate; repeated-session tests | `camera-pose.schema.json` (`trackingState`, `anchorConfidence`, `worldAnchorId`); `services/backend-api/src/sessions/sessions.controller.ts` (`POST /:id/camera-poses`); server-side ingestion is implemented and tested. **The CLIENT side of this control is NOT IMPLEMENTED.** It was previously attributed to `apps/ios-client/Sources/Spatial/ARSessionController.swift` (minting a new `worldAnchorId` on recovery from degraded tracking) and `TwoDFallbackBanner.swift`; that app was never compiled or run, and has been deleted. `apps/mobile` streams no camera poses and mints no `worldAnchorId` — verified by grep, no occurrences in `apps/mobile/src` or `apps/mobile/modules`. The AR jig module does reset its floor anchor on `sessionInterruptionEnded` and blocks recording on `tracking_unavailable` / `tracking_limited`, which prevents a clip being RECORDED through degraded tracking, but nothing segments a session by anchor identity, so there is no mechanism that would stop two segments either side of a re-anchor being pooled. Residual risk is unmitigated client-side, not merely unverified |
| HZ-05 | Unsafe exercise cue | Rule/plan incompatibility, reported symptom, contraindication | Hard pause and review; hazard analysis and clinician scenario testing | `services/backend-api/src/safety/safety-state-machine.ts`; `symptom-report.schema.json`; `services/backend-api/src/policy/policy-engine.service.ts` now emits real `cue`/`escalate_review` decisions from clinician-set `targetJointAngles`/`toleranceDegrees`/`repRange` (ADR-005) — deterministic rules only, ST-GCN/TCN structurally excluded from this path |
| HZ-06 | Sensor artifact/disconnect | Signal quality, timestamp freshness | No physiology-dependent decision; bench tests | `sensor-reading.schema.json`; `services/backend-api/src/sensors/sensors.controller.ts` (`POST /sensor-readings`, consent-scope gated). Ingestion-only this phase — no signal-quality/staleness check yet, and (per this control's own requirement) no `DecisionEvent` or safety transition may ever depend on a sensor reading; `SensorsModule` structurally never imports `SafetyService` |
| HZ-07 | Risk score overclaim | Report schema and copy review | Label observational indicators; clinician review; claims audit | `docs/claims-and-scope.md`; `scripts/lint-claims.sh` |
| HZ-09 | Induced fall or loss of balance during a balance manoeuvre (eyes-closed standing sway, single-leg stance) | Step declares its own risk: `requiresSpotter`, `eyesClosed`, `stance`; pre-execution clinician confirmation | Refuse to start recording until the clinician confirms arm's-reach supervision; per-step `contraindications` and `symptomStopRules`; outputs labelled exploratory | **NOT IMPLEMENTED.** No balance manoeuvre exists in the shipped battery (`references/assessment-battery.v0-draft.json` is four static holds), and `assessment-battery.schema.json` currently has **no** field able to express "eyes closed", which leg, a contraindication or a stop rule — those exist only on the unrelated `protocol-definition.schema.json`. The safety state machine models reported symptoms and measurement failure, and has no concept of a manoeuvre's intrinsic physical risk nor any way to refuse a step. This row is a **tripwire**: it must be structurally enforced before any such step ships, not merely documented (see the bar set in Notes below) |
| HZ-08 | Cohort performance gap | Stratified metrics by device, body shape, clothing, mobility, skin tone, lighting | Dataset expansion and release gate; prespecified subgroup analysis | Deferred — requires a real evaluation dataset (Phase 4+), not buildable in scaffolding |

## Notes for this phase

- HZ-01, HZ-02, HZ-03, HZ-05 are structurally enforced by schema constraints and/or
  the safety state machine and policy engine built in this pass — not just documented.
- HZ-09 is **declared but not enforced**, and is the only row in this table describing a
  hazard to the patient's body rather than to the measurement. HZ-05 is adjacent but
  distinct: it covers the system *cueing* something unsafe, not the *protocol asking* for
  something intrinsically risky. Nothing in the repo can currently refuse a capture step.
  Per the bar this table sets for HZ-01/02/03/05, HZ-09's control must be a structural
  pre-execution gate before an eyes-closed or single-leg step is added to the battery —
  shipping the manoeuvre with only this paragraph as its control would not satisfy it.
- HZ-04 is now implemented server-side (camera-pose ingestion, re-anchor
  segmentation) with a written-but-unverified iOS client. HZ-06 has a real,
  consent-gated ingestion endpoint but no signal-quality control yet. HZ-08 is
  still deferred — it needs a real evaluation dataset (Phase 4+), not buildable
  in scaffolding.
- `DecisionEvent.rule.ruleId` values from `policy-engine.service.ts` currently
  use engine-internal identifiers (e.g. `HZ-03` for the quality-unsupported
  path, carried over from the Phase 0/1 stub); extending every `ruleId` to
  reference this table's `controlId`s one-to-one remains a follow-up as the
  policy engine grows.
- A new `MovementPhaseEvent` (ST-GCN/TCN, ADR-005) and `ObjectDetectionFrame`
  (ADR-006/007) exist now as descriptive-only records; neither is wired to any
  `controlId` here because neither drives a safety decision.
