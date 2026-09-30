"""Real detector inference (not mocked) - but with randomly-initialized
weights, not pretrained COCO weights, since downloading them requires
network access to download.pytorch.org which is not available in every
environment (confirmed blocked in the sandbox this was authored in). This
proves the pipeline (model construction, tensor shapes, label filtering)
genuinely runs, while being honest that detection *accuracy* is untested here
- same pattern as the "no real photo of a person" limitation documented for
MediaPipe pose tests.
"""
import torch

from app.detection.yolo_adapter import ObjectDetectionAdapter, SUPPORTED_LABELS


def test_random_weights_adapter_runs_without_crashing():
    adapter = ObjectDetectionAdapter(use_pretrained_weights=False)
    assert adapter.using_pretrained_weights is False

    image = torch.rand(3, 320, 320)
    detections = adapter.detect(image)
    # Randomly-initialized weights carry no statistical meaning - assert only
    # that the pipeline runs and, if anything is returned, it's shaped correctly.
    for d in detections:
        assert d.label in {lbl.replace(" ", "_") for lbl in SUPPORTED_LABELS} | SUPPORTED_LABELS
        assert 0.0 <= d.confidence <= 1.0
