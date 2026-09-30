# Traceability matrix

Maps schema version × model/adapter version × protocol version × hazard-control-id.
Maintained manually in this phase (PRD/TRD-required traceability, TRD §2.2/§2.7);
automating this from `Event.payload.provenance` + `Event.type` is a named follow-up,
not attempted here.

## How to read this

Every emitted `PoseLandmarkFrame`, `CalibratedJointFrame`, `QualityGateFlag`, and
`DecisionEvent` carries a `provenance` block (or, for `DecisionEvent`, a `version`
field) identifying the schema/model/calibration versions that produced it. This
table is the human-readable index from "what's currently deployed" to "which
hazard controls does that satisfy."

| Schema | Schema version | Model/adapter version (this phase) | Hazard control(s) satisfied | Notes |
|---|---|---|---|---|
| `pose-landmark-frame` | v0 | `mediapipe-pose` (version pinned in `services/ml-service/pyproject.toml`) | HZ-01, HZ-03 | `observationState` enum is the HZ-03 control; `personTrackId` stability is the HZ-01 control. |
| `calibrated-joint-frame` | v0 | derived from `pose-landmark-frame` via `geometry/kinematics.py`; `scaleValidated` now derived from a real `ScaleCalibrationRecord` lookup (`geometry/coordinate_frames.py#is_scale_validated`) | HZ-02 | `scaleValidated=true` only when a `subject_specific` `ScaleCalibrationRecord` exists for the session (ADR-008); the other three enum methods are unimplemented, so `scaleValidated` stays `false` for any session that hasn't completed height entry + calibration. |
| `scale-calibration-record` | v0 | `services/ml-service/app/geometry/scale_calibration.py` (`ANKLE_TO_NOSE_HEIGHT_FRACTION = 0.97`) | HZ-02 | `subject_specific` only (ADR-008); requires observed ankle + nose landmarks, 422s otherwise — never a degraded estimate. |
| `quality-gate-flag` | v0 | `services/ml-service/app/quality/quality_gate.py` | HZ-01, HZ-02, HZ-03 | `unsupported` + non-empty `reasons` is schema-enforced (see `packages/schemas/codegen/contract.test.mjs`). |
| `decision-event` | v0 | `services/backend-api/src/policy/policy-engine.service.ts` (quality precedence, then `deviation-detector.service.ts`, then `rep-counter.service.ts`); FSM transitions via `services/backend-api/src/safety/safety-state-machine.ts` | HZ-03, HZ-05 | Precedence: unsupported quality → `measurement_unavailable` always wins, even under a simultaneous deviation signal (ADR-005, tested in `policy-engine.service.spec.ts`). `evidence[].type` now also allows `movement-phase-event`, `exposure-event`, `object-detection-frame`, `scale-calibration-record`, `sensor-reading` as descriptive context — none of these types may be the sole basis for a `cue`/`escalate_review`. |
| `movement-phase-event` | v0 | `services/ml-service/app/movement/{tcn_model,stgcn_model,movement_window_service}.py` — randomly-initialized weights, never trained in this sandbox | — (none; descriptive only) | `validated` is schema-locked `const: false` and independently forced `False` in code (ADR-005). Structurally excluded from `PolicyModule`/`SafetyService` — `MovementModule` never imports either. |
| `object-detection-frame` | v0 | `services/ml-service/app/detection/yolo_adapter.py` — torchvision `fasterrcnn_mobilenet_v3_large_320_fpn`, BSD-3 (ADR-007), generic-COCO-label scope only (ADR-006) | — (none; descriptive only) | 2D pixel bounding boxes in the `I` frame only, no `O`-frame localization. Falls back to random-init weights (logged) if pretrained-weight download fails. |
| `exposure-event` | v0 | `services/backend-api/src/exposure/exposure-aggregator.service.ts`; posture-bucket classification via `services/ml-service/app/exposure/posture_bucket_classifier.py` (documented v0 heuristic thresholds, not a validated ergonomic model) | HZ-07 | `validSeconds` counts only frames where quality was `supported`; unsupported time is excluded, never fabricated as bucket time. |
| `sensor-reading` | v0 | `services/backend-api/src/sensors/sensors.controller.ts` | HZ-06 | Consent-scope gated (`ConsentService.hasActiveScope`); never referenced by a safety transition — `SensorsModule` never imports `SafetyService`. |
| `session` | v0 | n/a (record, not a model) | — | Carries `deploymentContext`, `calibrationRef` (now explicitly the session's current `ScaleCalibrationRecord` id), `subjectHeightMeters`, current FSM `state`. |
| `symptom-report` | v0 | n/a | HZ-05 | Always accepted; drives `Pause`/`ClinicianReview` regardless of ML confidence. |
| `protocol-definition` | v0 | n/a | HZ-05, HZ-07 | `status: "draft"` protocols are schema-locked to `clinicallyValidated: false`. `exercises[].targetJointAngles` (new, optional) now populated in all 3 draft protocols, feeding the deviation detector. |
| `camera-pose` | v0 | `apps/ios-client/Sources/Spatial/ARSessionController.swift` (**unverified**, no Swift toolchain) → `services/backend-api/src/sessions/sessions.controller.ts` (`POST /:id/camera-poses`, verified server-side) | HZ-04 | `worldAnchorId` (new, required) is minted client-side on every recovery from degraded tracking; server-side ingestion/broadcast is tested, the iOS capture/streaming code is written but not run. |
| `consent-record` | n/a (Prisma model, not a JSON Schema) | `services/backend-api/src/consent/consent.service.ts` | HZ-06 | Session-independent; `sensor-reading` ingestion checks `scopes` before accepting a reading. |

## Known gap in this phase

`calibrated-joint-frame.scaleValidated` is `true` only for sessions that
completed real `subject_specific` scale calibration (ADR-008); it is `false`
for every other session, including any that would need one of the other three
TRD-approved methods (`known_size_reference`, `calibrated_depth`,
`stereo_multiview`) — none of those are implemented. This is intentional —
reporting `true` without a real check would violate `docs/coordinate-frames.md`'s
core rule — but it means **no metric distance or load claim is possible for a
session without a completed height-entry + calibration step**, only
normalized angles. Any consumer must respect this flag rather than assume
calibration exists.

`movement-phase-event.validated` is unconditionally `false` this phase (ADR-005)
— no consumer may treat a `predictedPhase`/`phaseConfidence` value as
statistically meaningful, and none may use it as the basis for a safety
decision.

The iOS AR/spatial code (`apps/ios-client/Sources/Spatial/`,
`Session/HeightEntryView.swift`, `Session/TwoDFallbackBanner.swift`,
`Networking/CameraPoseStreamingClient.swift`) is written to the same
standard as Phase 0/1's `SessionWebSocketClient.swift` but remains
**unverified** — no Swift toolchain is available in this sandbox. Every
server-side contract it targets (`POST /:id/height`, `POST
/:id/scale-calibration`, `POST /:id/camera-poses`) is tested independently.
