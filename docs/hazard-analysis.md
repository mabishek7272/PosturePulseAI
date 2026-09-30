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
| HZ-04 | AR anchor drift | World/object transform movement and plane confidence | Freeze overlay and recalibrate; repeated-session tests | `camera-pose.schema.json` (`trackingState`, `anchorConfidence`, `worldAnchorId`); `services/backend-api/src/sessions/sessions.controller.ts` (`POST /:id/camera-poses`); `apps/ios-client/Sources/Spatial/ARSessionController.swift` mints a new `worldAnchorId` on recovery from degraded tracking and `TwoDFallbackBanner.swift` makes the no-AR/degraded-AR state a first-class UI mode. Server-side ingestion is implemented and tested; the iOS AR code itself is written but **unverified** (no Swift toolchain in this sandbox — see `apps/ios-client/README.md`) |
| HZ-05 | Unsafe exercise cue | Rule/plan incompatibility, reported symptom, contraindication | Hard pause and review; hazard analysis and clinician scenario testing | `services/backend-api/src/safety/safety-state-machine.ts`; `symptom-report.schema.json`; `services/backend-api/src/policy/policy-engine.service.ts` now emits real `cue`/`escalate_review` decisions from clinician-set `targetJointAngles`/`toleranceDegrees`/`repRange` (ADR-005) — deterministic rules only, ST-GCN/TCN structurally excluded from this path |
| HZ-06 | Sensor artifact/disconnect | Signal quality, timestamp freshness | No physiology-dependent decision; bench tests | `sensor-reading.schema.json`; `services/backend-api/src/sensors/sensors.controller.ts` (`POST /sensor-readings`, consent-scope gated). Ingestion-only this phase — no signal-quality/staleness check yet, and (per this control's own requirement) no `DecisionEvent` or safety transition may ever depend on a sensor reading; `SensorsModule` structurally never imports `SafetyService` |
| HZ-07 | Risk score overclaim | Report schema and copy review | Label observational indicators; clinician review; claims audit | `docs/claims-and-scope.md`; `scripts/lint-claims.sh` |
| HZ-08 | Cohort performance gap | Stratified metrics by device, body shape, clothing, mobility, skin tone, lighting | Dataset expansion and release gate; prespecified subgroup analysis | Deferred — requires a real evaluation dataset (Phase 4+), not buildable in scaffolding |

## Notes for this phase

- HZ-01, HZ-02, HZ-03, HZ-05 are structurally enforced by schema constraints and/or
  the safety state machine and policy engine built in this pass — not just documented.
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
