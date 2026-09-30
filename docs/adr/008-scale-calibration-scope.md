# ADR-008: Only subject-specific scale calibration is implemented this phase

## Status
Accepted (Phase 2 engineering scaffolding) — confirmed with the user before
implementation.

## Context
`scale-calibration-record.schema.json`'s `method` enum lists four
TRD-approved scale-validation methods: `subject_specific`,
`known_size_reference`, `calibrated_depth`, and `stereo_multiview`. Per
`docs/coordinate-frames.md`, `calibrated-joint-frame.scaleValidated` must
stay `false` until one of these checks actually passes — reporting `true`
without a real check would fabricate a measurement (`CLAUDE.md` rule 3).

Three of the four methods need inputs this sandbox cannot produce or
verify: `known_size_reference` needs a real reference-object photograph
with a trusted known size; `calibrated_depth` needs ARKit scene-depth
hardware/data (see `apps/ios-client/Sources/Spatial/DepthAvailabilityChecker.swift`,
which only checks the *capability*, computing nothing); `stereo_multiview`
needs multiple synchronized camera views. None of these can be exercised
with synthetic unit-test data the way a pure geometric function can.

## Decision
Only `subject_specific` calibration is implemented this phase:
`services/ml-service/app/geometry/scale_calibration.py`'s
`compute_subject_specific_scale()` derives a scale factor from a
clinician/patient-entered height (`Session.subjectHeightMeters`, fed by
`apps/ios-client/Sources/Session/HeightEntryView.swift`) and the observed
ankle-to-nose landmark span, using a fixed anthropometric fraction
(`ANKLE_TO_NOSE_HEIGHT_FRACTION = 0.97`). It requires both ankle and nose
landmarks to be `observed` (not `occluded`/`out_of_frame`) — the ml-service
`/internal/calibrate-scale` route returns 422 rather than a degraded
estimate if they aren't, and the iOS client's `submitScaleCalibrationFrame`
treats any non-2xx response as a hard failure requiring reposition-and-retry,
never a fallback success.

The other three methods remain in the schema `enum` (so records are
forward-compatible once implemented) but have no corresponding
implementation, and `is_scale_validated()`
(`services/ml-service/app/geometry/coordinate_frames.py`) only returns
`true` when a real `ScaleCalibrationRecord` exists for the session — it
does not special-case or fake the other methods.

## Rationale
`ANKLE_TO_NOSE_HEIGHT_FRACTION` is a documented anthropometric
approximation, not a per-subject measurement — its own uncertainty is
carried in the resulting record's `uncertaintyMetersPerUnit`, never
presented as exact. This keeps the honesty pattern consistent: a scale
factor is only ever produced from a real height entry and real observed
landmarks, and its precision is stated rather than assumed.

## Follow-up
`known_size_reference`, `calibrated_depth`, and `stereo_multiview`
calibration are deferred to a phase with either real reference-object
photography, ARKit scene-depth data (once `DepthAvailabilityChecker` is
joined by an actual depth-sampling implementation), or multi-camera
capture. Each should get a real geometric implementation and its own test
suite before `is_scale_validated()` is extended to recognize it — never by
loosening the current all-or-nothing check.
