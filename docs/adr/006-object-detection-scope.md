# ADR-006: Object detection is generic-detector-only, no task-specific classification

## Status
Accepted (Phase 2 engineering scaffolding)

## Context
The TRD calls for workstation-object awareness (desk, monitor, chair) to
eventually support the `O` (workstation object frame) coordinate frame
described in `docs/coordinate-frames.md`. Building a real desk/monitor/chair
classifier requires either a fine-tuned detector or a curated label set for
those specific classes — neither exists in this sandbox, and fabricating a
detector that merely reuses generic COCO-style labels while claiming
workstation-specific semantics would misrepresent what the model does.

## Decision
`services/ml-service/app/detection/yolo_adapter.py` wraps a generic
pretrained detector (see ADR-007 for which one) restricted to a fixed
`SUPPORTED_LABELS` set of generic COCO categories (e.g. `person`, `chair`,
`laptop`, `tv`) at a fixed `CONFIDENCE_THRESHOLD`. It emits 2D pixel
bounding boxes only, via `object-detection-frame.schema.json`
(`detections[].boundingBox`, always in the `I` image-pixel frame).

Explicitly **not** implemented this phase:
- No workstation-specific classification (a `chair` detection is a chair
  the generic detector recognizes, not a verified ergonomic-assessment
  chair).
- No `O`-frame localization — a 2D bounding box is not projected into any
  3D object-centered frame. Doing so correctly needs the object's real-world
  size/pose, which needs calibrated depth or a known-size reference; neither
  exists yet (see ADR-008 and `docs/coordinate-frames.md`).

## Rationale
`object-detection-frame.schema.json` and its `provenance` field make the
detector's real identity and version inspectable, so downstream consumers
know exactly what kind of detection they're looking at rather than assuming
task-specific accuracy that was never built or validated. This mirrors the
project's existing approach to `calibrated-joint-frame.scaleValidated`:
report what was actually computed, flag what wasn't.

## Follow-up
A real `O`-frame object-localization pipeline, and any workstation-specific
classifier, are future-phase work requiring either a labeled workstation
dataset or a calibrated-depth/known-size-reference pipeline (ADR-008) to
place detections in 3D. Neither should be attempted by silently extending
`yolo_adapter.py`'s output semantics — a new schema field and a new ADR
should accompany that work.
