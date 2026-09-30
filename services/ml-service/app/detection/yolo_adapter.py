"""Generic person/object detector for TRD 2.2's "YOLO handles person/object
detection and tracking" role. Despite the module name (kept for parity with
the PRD/TRD's own naming), this uses **torchvision's Faster R-CNN**
(fasterrcnn_mobilenet_v3_large_320_fpn, BSD-3-licensed), not Ultralytics
YOLOv8 (AGPL-3.0) - see docs/adr/007-detector-license.md. It satisfies the
TRD's intent (a lightweight, real-time-capable detector) without committing
the project to a copyleft dependency by default.

This is a GENERIC COCO-class detector only. It does NOT do desk/chair/monitor-
specific ergonomic classification or any 3D/workstation-object-frame
localization - see docs/adr/006-object-detection-scope.md.

Pretrained COCO weights require downloading from download.pytorch.org, which
is not reachable from every environment (confirmed blocked in the sandbox
this was authored in). When weights can't be fetched, this adapter falls back
to randomly-initialized weights rather than crashing - detections from that
fallback carry no statistical meaning (same honesty pattern as
app/movement/*.py) and callers must not present them as real detections. See
tests/test_yolo_adapter.py for how this is exercised without network access.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import torch
from torchvision.models.detection import (
    FasterRCNN_MobileNet_V3_Large_320_FPN_Weights,
    fasterrcnn_mobilenet_v3_large_320_fpn,
)

logger = logging.getLogger(__name__)

# Standard 91-entry COCO category list (index 0 = background) used by
# torchvision's pretrained detection models - stable regardless of whether
# pretrained weights actually loaded.
_COCO_WEIGHTS_META = FasterRCNN_MobileNet_V3_Large_320_FPN_Weights.DEFAULT.meta
COCO_CATEGORIES: list[str] = _COCO_WEIGHTS_META["categories"]

# Only these COCO categories are surfaced - matches
# object-detection-frame.schema.json's `detections[].label` enum exactly.
SUPPORTED_LABELS = {
    "person", "chair", "couch", "dining table", "tv", "laptop",
    "keyboard", "mouse", "cell phone", "book", "bottle", "cup",
}

# Schema enum uses underscores for multi-word labels; COCO's own names use spaces.
_LABEL_TO_SCHEMA_ENUM = {
    "dining table": "dining_table",
    "cell phone": "cell_phone",
}

CONFIDENCE_THRESHOLD = 0.5


@dataclass(frozen=True)
class RawDetection:
    label: str  # already mapped to the schema enum spelling
    x_min: float
    y_min: float
    x_max: float
    y_max: float
    confidence: float


class ObjectDetectionAdapter:
    def __init__(self, use_pretrained_weights: bool = True) -> None:
        self._using_pretrained = False
        if use_pretrained_weights:
            try:
                # Accessing .DEFAULT is free (metadata only); the actual
                # download happens inside this constructor call.
                weights = FasterRCNN_MobileNet_V3_Large_320_FPN_Weights.DEFAULT
                self._model = fasterrcnn_mobilenet_v3_large_320_fpn(weights=weights)
                self._using_pretrained = True
            except Exception:  # network/download failure - fall back honestly
                logger.warning(
                    "Could not download pretrained detector weights - falling back to "
                    "randomly-initialized weights. Detections will carry no statistical "
                    "meaning until this is run somewhere with access to download.pytorch.org."
                )
                self._model = fasterrcnn_mobilenet_v3_large_320_fpn(weights=None, weights_backbone=None)
        else:
            self._model = fasterrcnn_mobilenet_v3_large_320_fpn(weights=None, weights_backbone=None)
        self._model.eval()

    @property
    def using_pretrained_weights(self) -> bool:
        return self._using_pretrained

    def detect(self, image_chw_float_0_1: torch.Tensor) -> list[RawDetection]:
        """`image_chw_float_0_1`: float tensor, shape [3, H, W], values in [0, 1]."""
        with torch.no_grad():
            result = self._model([image_chw_float_0_1])[0]

        detections: list[RawDetection] = []
        for box, label_idx, score in zip(result["boxes"], result["labels"], result["scores"]):
            if score.item() < CONFIDENCE_THRESHOLD:
                continue
            coco_label = COCO_CATEGORIES[label_idx.item()]
            if coco_label not in SUPPORTED_LABELS:
                continue
            schema_label = _LABEL_TO_SCHEMA_ENUM.get(coco_label, coco_label)
            x_min, y_min, x_max, y_max = box.tolist()
            detections.append(RawDetection(schema_label, x_min, y_min, x_max, y_max, score.item()))
        return detections
