# @beaive/schemas changelog

Each canonical record's `version` field (embedded in its own schema file) is the
authoritative version for that record type. This file is a human-readable log of
what changed and why; it is not machine-consumed.

## v0 - initial Phase 0 baseline

All ten canonical records introduced at `version: "v0"`:

- `camera-intrinsics` - K, distortion, resolution, orientation (TRD 2.1).
- `camera-pose` - T_WC(t): device localization in the local AR world frame.
- `pose-landmark-frame` - per-frame estimated landmarks with confidence and an
  explicit `observationState` (`observed` | `imputed` | `occluded`) so an occluded
  joint can never be presented as observed.
- `calibrated-joint-frame` - joint angles derived via the TRD 2.1 `theta = acos(...)`
  formula, gated by `scaleValidated`.
- `quality-gate-flag` - first-class `unsupported` state; `reasons` required non-empty
  whenever `state=unsupported`.
- `decision-event` - `evidence + rule + action + version + expiry`, the deterministic
  safety-gate output.
- `session` - subject pseudo-ID, protocol/version, consent ref, retention policy,
  current safety-FSM state.
- `symptom-report` - user-entered symptom report; always accepted, drives an
  immediate FSM transition.
- `consent-record` - consent scope taxonomy and grant/revocation timestamps.
- `protocol-definition` - clinician-authored exercise protocol as data; `status:
  "draft"` protocols are schema-constrained to `clinicallyValidated: false` and
  `reviewedBy: null`.

No breaking changes yet - this is the first cut.

## v0 - Phase 2/3 additions (non-breaking)

- `decision-event.evidence[].type` enum extended with `movement-phase-event`,
  `exposure-event`, `object-detection-frame`, `scale-calibration-record`,
  `sensor-reading`.
- `protocol-definition.exercises[]` gained an **optional** `targetJointAngles`
  array (clinician-authored target angle per joint). An exercise without it
  cannot drive a deviation-based cue - the policy engine falls back to
  `no_action`, never fabricating a target.
- `camera-pose` gained a **required** `worldAnchorId` field - a new UUID must
  be minted on every AR re-anchor; records under different IDs are not
  metrically comparable.
- New: `object-detection-frame` (generic 2D detections, no task-specific
  ergonomic classification), `scale-calibration-record` (only
  `subject_specific` implemented this phase), `exposure-event` (posture-bucket
  valid-time tracking), `movement-phase-event` (`validated` hard-constrained
  to `false` via `"const": false` - ST-GCN/TCN output, descriptive-only, never
  cited by a safety-relevant decision), `sensor-reading` (optional,
  non-safety-gating wearable input).

See `docs/adr/005-deterministic-policy-engine.md` through
`docs/adr/008-scale-calibration-scope.md` for the reasoning behind these.

## v0 - M1 static battery (non-breaking)

- New: `clip-capture` (per-frame gravity/timestamp sidecar for a recorded clip,
  ADR-013), `metric-result` (one measurement, `oneOf` estimate/unsupported/
  notMeasurable, ADR-015), `reference-range-set` (draft geometric/literature
  reference ranges), `assessment-battery` (the capture-step sequence a session
  runs), `assessment-report` (versioned, clinician-signed report built from
  metric results, ADR-015).
- `quality-gate-flag`'s `reasons` enum (factored into `$defs/reason`) extended
  with `wrong_view`, `out_of_frame`, `camera_not_level`,
  `insufficient_frame_rate`, `insufficient_frames`, `subject_moving`.
- `common.provenance` gained **optional** `metricsVersion`, `referenceFileVersion`,
  `clipSha256`.

## v0 - measurement method provenance (non-breaking)

- `common.$defs` gained `measurementMethod`, an enum of what produced a
  measurement (`mediapipe_2d_image_plane`, `clinician_manual`,
  `clinician_annotated`, `entered`; `markerless_3d` reserved, unimplemented).
  Referenced as an **optional** property on `common.provenance`, so it reaches
  every record that already embeds provenance with no further schema change.
- `metric-result.tier`'s description no longer says "2D" - that was the method
  axis leaking into the confidence-tier axis; `provenance.measurementMethod`
  is now the single place a record states how it was measured.
- `assessment-report`'s row gained **optional** `method`
  (`$ref measurementMethod`) and `measuredBy { modelVersion, adapterVersion?,
  metricsVersion? }`, carrying the underlying measurement's own provenance onto
  the row - previously dropped by the report builder, leaving only the
  report-level `provenance.modelVersion`, which identifies the report builder
  itself, not what measured the body (CLAUDE.md rule 4).
- Both new row fields are optional, not required: released report bodies are
  never re-validated after sign-off, so a required field would reject any
  future migration or export of a report signed before this change.

See `docs/adr/018-measurement-method-and-validation-strategy.md` for why the
product's own measurement method is scoped to `mediapipe_2d_image_plane` only,
and why a method-aware reference lookup (keying `reference-range-set` entries
by method, not just `metricKey`) is deferred rather than built here.

## v0 - report row disambiguation and reference bounds (non-breaking)

- `assessment-report`'s row gained **optional** `stepId`, `signConvention`, and (on `reference`) `value`/
  `min`/`max`. All optional, matching the existing pattern for `method`/`measuredBy` - released report bodies
  signed before this change remain valid with no migration.
- `stepId` lets a client group/disambiguate left-and-right rows of the same metric across different battery
  steps; `signConvention` carries the same text `metric-result` already has; the numeric reference bounds let
  a client draw a reference band without parsing the existing text `label` (e.g. "0-5 deg").

See docs/HANDOFF.md §4.C items #1-#3.

## v0 - report-rejection schema registered (non-breaking, new record type)

- New `report-rejection` schema, `version: "v0"`, matching the `report-rejection/v0` event id
  `services/backend-api/src/reports/reports.service.ts` already emits - previously an id with no registered
  shape (HANDOFF §4.C item #9).

## v0 - clip-capture depth track (non-breaking, additive)

- `clip-capture` gained an **optional** `depth` block: `{width, height, encoding,
  scaleMillimetres, nominalFps?, frameCount, sha256, hasConfidence, frames[]}`.
  `version` stays `v0` because the field is optional and every sidecar valid
  before this change is still valid: a v0 reader that ignores `depth` behaves
  exactly as it did.
- `frames[]` inside `depth` carries its own `{index, t}` per depth frame. The
  depth track is a **separate, sparser time series** from the video `frames[]` -
  deliberately not index-aligned, because depth arrives at ~15 Hz against video
  at 30-60 Hz and frames are dropped. A missing depth frame is simply absent
  from the array; `t` gaps are expected and must not be interpolated
  (CLAUDE.md rule 3 - a fabricated depth frame is a fabricated measurement).
- `encoding` is an **enum**, not free text, so an unrecognised encoding is
  rejected at the schema boundary rather than being read as millimetres. For the
  same reason `scaleMillimetres` is carried explicitly instead of assumed.
- The one value, `uint16_millimetres_deflate`, names **raw DEFLATE** (RFC 1951)
  rather than zlib: Apple's Compression framework emits raw DEFLATE for
  `COMPRESSION_ZLIB`, with no two-byte header and no Adler-32 trailer, and the
  iOS writer uses it. Calling the format "zlib" would have sent every reader
  looking for a header that was never written - which fails as a decode error on
  the first frame, loudly, but only after someone has spent a while on it.
- `additionalProperties: false` is set on the `depth` object and on its frame
  objects. It is deliberately **not** added to the pre-existing video `frames[]`
  item or to the top level: those have shipped without it, so adding it now
  would reject sidecars from TestFlight builds already in the field. The new
  block has no deployed producers, so it can be strict from the start - which is
  where it matters, since an unknown field here would otherwise pass AJV, persist
  into `Clip.sidecar`, and then vanish silently at ml-service's Pydantic boundary.

See `docs/adr/020-lidar-2.5d-depth-fusion.md` (Proposed - the depth path stays
behind a flag and emits no metric until a clinical lead signs it off).

## v1 - quality-gate-flag depth reasons (BREAKING for a strict v0 reader)

- `quality-gate-flag` goes **v0 -> v1**. Four reasons added for the single-view
  LiDAR path (ADR-020): `depth_unavailable`, `insufficient_depth_samples`,
  `depth_landmark_disagreement`, `torso_plane_underdetermined`.
- Each maps one-to-one onto a refusal that exists in code, which is why there
  are four and not more: `depth_unavailable` to a missing track or missing
  intrinsics, `insufficient_depth_samples` to the patch pixel-count gate,
  `depth_landmark_disagreement` to the MAD and consensus gates, and
  `torso_plane_underdetermined` to `fit_torso_plane` returning None. A reason
  with no implementing path would be a promise the pipeline cannot keep.
- `depth_unavailable` is the one that could not be left out: the v0 enum had
  nothing meaning "there was no depth track at all", so a clip from an iPad with
  no LiDAR would have been indistinguishable from a depth track that arrived and
  failed. Reusing `insufficient_scale` or `low_confidence` for any of these would
  make a depth failure indistinguishable from a 2D one, which defeats the point
  of an explicit `unsupported` state.
- **Why this is breaking.** Adding enum members is backwards-compatible for
  producers and breaking for consumers: a validator pinned to v0 rejects a record
  carrying a new reason. `metric-result` and `assessment-report` both `$ref` this
  enum, so both regenerate - their own shapes are unchanged and their `version`
  fields stay `v0`, because the enum is defined here and it is this record's
  version that carries it.
- Three consumers updated in the same change: `app/versioning.py`'s
  `SCHEMA_VERSION_QUALITY_GATE_FLAG`, the `QualityReason` union in
  `backend-api/src/battery/types.ts`, and `REASON_WORDS` in
  `report-templates.ts`. The last is a `Record<QualityReason, string>`, so
  widening the union without adding the wording fails the typecheck, and
  `report-templates.ts:126` already throws on an unknown reason at runtime - the
  report build fails loudly rather than rendering "Not measured: undefined".

## v0 - measurementMethod gains the depth path (non-breaking, additive)

- `common`'s `measurementMethod` gains `mediapipe_2_5d_depth`: MediaPipe
  landmarks in the image plane, depth from the device's depth sensor.
- **One value for the whole depth path, not one per metric.** A per-metric method
  string would split `app/analysis/agreement.py`'s strata by metric as well as by
  method, and neither half would reach a useful n. The metric key already
  distinguishes the metric; the method describes how the body was measured.
- Deliberately **not** `markerless_3d`, which is documented as reserved for a
  multi-camera pipeline. Pooling single-view LiDAR (per-point sigma about 20 mm,
  extremity depth interpolated from under one real return) with triangulated
  multi-camera data would corrupt that agreement analysis and produce an accuracy
  figure neither method earns.
- The name keeps `mediapipe` in it on purpose: the dominant error in every
  depth-derived angle is the IN-PLANE landmark error, which is MediaPipe's, not
  the LiDAR's - 0.0358 m against 0.0117 m at 2.5 m. A name describing only the
  depth sensor would misattribute the uncertainty.
- `report-builder.ts` forces `position: "no_reference"` for any non-default
  method, so adding this value cannot give a depth-derived row a reference
  comparison it has not earned. That control is the architectural guardrail; the
  feature flag is only runtime convenience.
