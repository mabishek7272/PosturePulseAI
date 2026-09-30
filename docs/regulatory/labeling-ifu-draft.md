# Labeling / Instructions for Use — draft

Source: ADR-011, `docs/claims-and-scope.md`, `docs/intended-use-matrix.md`.
**An unreviewed draft.** Every claim below is bounded to exactly the
evidenced Level A per `docs/claims-and-scope.md`'s claims ladder — nothing
here should be loosened without also revisiting that policy and
`docs/regulatory/device-classification-analysis.md` (a stronger claim can
change the device's classification analysis). Must be reviewed by a
clinical lead, regulatory affairs professional, and (once one exists) the
actual approved intended-use statement before any real use.

## Product name

beAIve [Spatial Posturology Platform — TBD final naming]

## Intended use (draft — pending final approval)

beAIve estimates joint angles and posture/movement patterns from video
during clinician-prescribed exercise sessions, for **clinician review** in
`clinic_supervised` or `home_rehab` contexts (`docs/intended-use-matrix.md`).
It is intended to support, not replace, clinical judgment.

## What this device does

- Estimates joint angles during specific exercises, with stated uncertainty.
- Flags when a measurement cannot be made with sufficient confidence,
  rather than providing one anyway.
- Records session events (angles, quality flags, symptom reports, clinician
  decisions) for clinician review.
- Provides a rule-based cue when a clinician-configured target angle or
  tolerance is exceeded (`docs/adr/005-deterministic-policy-engine.md`) —
  this rule is set by a clinician for a specific protocol, not learned or
  inferred by the system.
- Allows the subject to stop a session at any time, for any reason.

## What this device does NOT do

Per `docs/claims-and-scope.md`'s hard boundary, this device does not:

- Diagnose any condition.
- Measure spinal curvature, tissue loading, pain, muscle fatigue, or tremor
  directly — it estimates *visible geometry*, not internal physiological
  state.
- Predict future injury.
- Provide a numeric "posture score" implying medical meaning.
- Make any autonomous treatment decision — every cue is a clinician-set
  rule notification, reviewed in context by a clinician, not an automated
  diagnosis or prescription.
- Replace a validated physiological sensor when one is clinically indicated.

## Warnings

- [TBD (clinical lead)] Do not use if [contraindications — protocol-specific,
  see `protocols/*.json`'s `contraindications` field, currently draft/example
  data only].
- Stop the exercise immediately if you experience pain, dizziness, weakness,
  or breathlessness, and use the stop function. [TBD: full warning language]
- This device has not been clinically validated for [TBD: scope this
  explicitly once Study A/B/C evidence exists or explicitly doesn't].

## Precautions

- Requires adequate lighting and an unobstructed camera view; the device
  will indicate when this is not met rather than provide a degraded
  estimate silently.
- [TBD: device/OS compatibility statement — this repository has not
  validated the iOS client on any physical device, see
  `apps/ios-client/README.md`]

## Symbols / regulatory markings

**None applied.** No regulatory clearance exists for this device in any
jurisdiction (ADR-011). Do not apply a CE mark, MDA registration mark, FDA
clearance statement, or equivalent to any build of this software until the
actual corresponding approval exists.

## Version and provenance

Every record this system produces carries a `provenance` block identifying
the exact schema/model/calibration versions that produced it
(`packages/schemas/src/common.schema.json#/$defs/provenance`) — so any
printed or displayed measurement can be traced to the software version that
computed it. [TBD: how this maps to a customer-facing device/software
version number for labeling purposes — not yet defined.]

## What this document is not

Not approved labeling. Not evidence that any content above has been
reviewed by a clinical lead, legal counsel, or a regulatory body. Not to be
distributed, printed, or displayed to any real user or clinician as
authoritative instructions for use.
