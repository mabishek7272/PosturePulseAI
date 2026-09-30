# ADR-007: torchvision Faster R-CNN (BSD-3) over Ultralytics YOLOv8 (AGPL-3.0)

## Status
Accepted (Phase 2 engineering scaffolding) — confirmed with the user before
implementation.

## Context
The TRD's intent for object detection is a lightweight, real-time-capable
generic detector (ADR-006). The most commonly reached-for option for this is
Ultralytics YOLOv8, but Ultralytics licenses YOLOv8 under AGPL-3.0 (with a
separate commercial license available). AGPL-3.0's network-use copyleft
terms are a significant default constraint for a clinician-supervised
health-adjacent product whose eventual licensing posture is not yet decided
(Phase 4/5 territory).

## Decision
`services/ml-service/app/detection/yolo_adapter.py` (name kept for
call-site continuity with the plan's original wording; the module does not
use YOLO) wraps **torchvision's `fasterrcnn_mobilenet_v3_large_320_fpn`**,
licensed BSD-3 as part of the PyTorch project. It is not the literal YOLO
architecture, but it satisfies the same functional requirement — a
pretrained, real-time-capable, generic-object detector — without adopting a
copyleft dependency by default.

## Rationale
- BSD-3 imposes no network-use disclosure obligation, keeping this
  scaffolding's licensing posture unconstrained for whatever the product's
  eventual licensing decision turns out to be.
- torchvision ships pretrained COCO weights, satisfying ADR-006's
  generic-detector scope without any additional training data.
- `pyproject.toml`'s `detection`/`movement` extras already pull in
  `torch`/`torchvision` for the movement module (ADR-005's TCN/ST-GCN), so
  this choice adds no new heavy dependency family.

## Consequences
- Detection accuracy/speed differs from YOLOv8; if a future phase needs
  YOLO-specific behavior, that requires either accepting AGPL-3.0's terms
  (and the commercial-licensing question that follows) or finding another
  permissively-licensed detector. This is a deliberate trade-off, not an
  oversight — do not silently swap in an AGPL-licensed detector later
  without a new ADR revisiting this decision.
- `ObjectDetectionAdapter` falls back to randomly-initialized weights
  (`weights=None`) if the pretrained download fails (observed in this
  sandbox, since `download.pytorch.org` is proxy-blocked) — logged clearly
  as a fallback, never silently presented as a working pretrained detector.
