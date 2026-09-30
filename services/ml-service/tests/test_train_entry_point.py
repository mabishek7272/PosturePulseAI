import json

import torch

from app.movement.joint_graph import NUM_CHANNELS
from app.movement.movement_window_service import PHASE_LABELS
from app.movement.train_entry_point import class_weights, train


def _write_windows(path, n_per_label=12, window=10):
    lines = []
    for label_index, label in enumerate(["descend", "hold", "ascend"]):
        for i in range(n_per_label):
            features = [[float(label_index) + 0.01 * i] * NUM_CHANNELS for _ in range(window)]
            lines.append(json.dumps({"features": features, "label": label}))
    path.write_text("\n".join(lines) + "\n")


def test_class_weights_zero_for_absent_classes():
    labels = torch.tensor([0, 0, 0, 1])
    weights = class_weights(labels)
    assert weights[PHASE_LABELS.index("unknown")] == 0
    assert weights[1] > weights[0] > 0


def test_train_writes_checkpoint_and_unvalidated_metadata(tmp_path):
    train_path, val_path = tmp_path / "train.jsonl", tmp_path / "val.jsonl"
    _write_windows(train_path)
    _write_windows(val_path, n_per_label=4)
    checkpoint = tmp_path / "ckpt" / "tcn.pt"

    metadata = train(train_path, "tcn", epochs=2, checkpoint_out=checkpoint, batch_size=8, val_path=val_path, device="cpu")

    assert checkpoint.exists()
    saved = json.loads((tmp_path / "ckpt" / "tcn.pt.meta.json").read_text())
    assert saved["validated"] is False
    assert saved["trainDataset"]["windows"] == 36
    assert saved["valDataset"]["windows"] == 12
    assert len(saved["trainDataset"]["sha256"]) == 64
    assert 1 <= saved["bestEpoch"] <= 2
    assert set(saved["valMetrics"]["support"]) == {"descend", "hold", "ascend"}
    assert metadata["modelVersion"] == "tcn-trained-unvalidated/v0"
