#!/usr/bin/env python3
"""Training entry point for tcn_model.py/stgcn_model.py.

A checkpoint produced here carries no clinical claim: `validated` stays
false in its metadata and in movement_window_service.py, and its output must
never drive a safety decision (docs/adr/005). Labels from
kimore_converter.py are kinematic heuristics, not clinician annotations.

Usage:
    python3 -m app.movement.train_entry_point --dataset-path train.jsonl --val-path val.jsonl \
        --model tcn --epochs 30 --checkpoint-out /path/to/checkpoint.pt --device cuda:1

Expected dataset format (JSON Lines), one labeled window per line:
    {"features": [[...NUM_CHANNELS floats...], ...T rows...], "label": "descend"}

Writes <checkpoint-out> (best val macro recall, or last epoch without
--val-path) and <checkpoint-out>.meta.json with provenance and metrics.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset

from app.movement.joint_graph import JOINT_CHANNELS, NUM_CHANNELS
from app.movement.movement_window_service import PHASE_LABELS
from app.movement.stgcn_model import STGCNPhaseClassifier
from app.movement.tcn_model import TCNPhaseClassifier


class LabeledWindowDataset(Dataset):
    def __init__(self, dataset_path: Path) -> None:
        features: list[list[list[float]]] = []
        labels: list[int] = []
        with dataset_path.open() as f:
            for line in f:
                line = line.strip()
                if line:
                    row = json.loads(line)
                    features.append(row["features"])
                    labels.append(PHASE_LABELS.index(row["label"]))
        # [N, T, NUM_CHANNELS] -> [N, NUM_CHANNELS, T]
        self.features = torch.tensor(features, dtype=torch.float32).transpose(1, 2) if features else torch.empty(0)
        self.labels = torch.tensor(labels, dtype=torch.long)

    def __len__(self) -> int:
        return len(self.labels)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, int]:
        return self.features[index], int(self.labels[index])


def build_model(name: str) -> nn.Module:
    if name == "tcn":
        return TCNPhaseClassifier(num_classes=len(PHASE_LABELS), num_channels=NUM_CHANNELS)
    if name == "st-gcn":
        return STGCNPhaseClassifier(num_classes=len(PHASE_LABELS), num_channels=NUM_CHANNELS)
    raise ValueError(f"Unknown model '{name}' - expected 'tcn' or 'st-gcn'.")


def class_weights(labels: torch.Tensor) -> torch.Tensor:
    """Inverse-frequency weights; classes absent from training get weight 0."""
    counts = torch.bincount(labels, minlength=len(PHASE_LABELS)).float()
    weights = torch.where(counts > 0, counts.sum() / (counts.clamp(min=1) * (counts > 0).sum()), torch.zeros_like(counts))
    return weights


def evaluate(model: nn.Module, loader: DataLoader, device: torch.device) -> dict:
    num_classes = len(PHASE_LABELS)
    confusion = torch.zeros(num_classes, num_classes, dtype=torch.long)
    model.eval()
    with torch.no_grad():
        for features, labels in loader:
            preds = model(features.to(device)).argmax(dim=1).cpu()
            confusion += torch.bincount(labels * num_classes + preds, minlength=num_classes**2).view(num_classes, num_classes)
    support = confusion.sum(dim=1)
    recall = {
        PHASE_LABELS[i]: float(confusion[i, i] / support[i]) for i in range(num_classes) if support[i] > 0
    }
    total = int(support.sum())
    return {
        "accuracy": float(confusion.diag().sum() / total) if total else 0.0,
        "macroRecall": sum(recall.values()) / len(recall) if recall else 0.0,
        "recallByClass": recall,
        "support": {PHASE_LABELS[i]: int(support[i]) for i in range(num_classes) if support[i] > 0},
        "confusion": confusion.tolist(),
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def train(
    dataset_path: Path,
    model_name: str,
    epochs: int,
    checkpoint_out: Path,
    batch_size: int = 64,
    val_path: Path | None = None,
    device: str | None = None,
    lr: float = 1e-3,
    seed: int = 0,
    model_version: str | None = None,
) -> dict:
    random.seed(seed)
    torch.manual_seed(seed)
    torch_device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))

    dataset = LabeledWindowDataset(dataset_path)
    if len(dataset) == 0:
        raise ValueError(f"No labeled windows found in {dataset_path}")
    val_dataset = LabeledWindowDataset(val_path) if val_path else None

    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=512) if val_dataset and len(val_dataset) else None
    model = build_model(model_name).to(torch_device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = nn.CrossEntropyLoss(weight=class_weights(dataset.labels).to(torch_device))

    checkpoint_out.parent.mkdir(parents=True, exist_ok=True)
    history = []
    best = {"epoch": 0, "macroRecall": -1.0}
    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0.0
        for features, labels in loader:
            features, labels = features.to(torch_device), labels.to(torch_device)
            optimizer.zero_grad()
            loss = loss_fn(model(features), labels)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
        entry = {"epoch": epoch, "trainLoss": total_loss / len(loader)}
        if val_loader:
            val_metrics = evaluate(model, val_loader, torch_device)
            entry["valAccuracy"] = val_metrics["accuracy"]
            entry["valMacroRecall"] = val_metrics["macroRecall"]
        history.append(entry)
        print(json.dumps(entry))

        score = entry.get("valMacroRecall", float(epoch))
        if score > best["macroRecall"]:
            best = {"epoch": epoch, "macroRecall": score}
            torch.save(model.state_dict(), checkpoint_out)

    model.load_state_dict(torch.load(checkpoint_out, map_location=torch_device))
    metadata = {
        "modelArchitecture": model_name,
        "modelVersion": model_version or f"{model_name}-trained-unvalidated/v0",
        "validated": False,
        "phaseLabels": PHASE_LABELS,
        "jointChannels": JOINT_CHANNELS,
        "trainDataset": {"path": str(dataset_path), "sha256": _sha256(dataset_path), "windows": len(dataset)},
        "valDataset": (
            {"path": str(val_path), "sha256": _sha256(val_path), "windows": len(val_dataset)} if val_path else None
        ),
        "hyperparameters": {"epochs": epochs, "batchSize": batch_size, "lr": lr, "seed": seed},
        "bestEpoch": best["epoch"],
        "trainMetrics": evaluate(model, DataLoader(dataset, batch_size=512), torch_device),
        "valMetrics": evaluate(model, val_loader, torch_device) if val_loader else None,
        "history": history,
        "torchVersion": torch.__version__,
        "device": str(torch_device),
        "trainedAt": datetime.now(timezone.utc).isoformat(),
    }
    meta_path = checkpoint_out.with_name(checkpoint_out.name + ".meta.json")
    meta_path.write_text(json.dumps(metadata, indent=2))
    print(f"Saved checkpoint to {checkpoint_out} (epoch {best['epoch']}) and metadata to {meta_path}")
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dataset-path", type=Path, required=True)
    parser.add_argument("--val-path", type=Path, default=None)
    parser.add_argument("--model", choices=["tcn", "st-gcn"], default="tcn")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--checkpoint-out", type=Path, required=True)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--device", default=None, help="e.g. cuda:1; defaults to cuda if available")
    parser.add_argument("--model-version", default=None)
    args = parser.parse_args()

    train(
        args.dataset_path, args.model, args.epochs, args.checkpoint_out, args.batch_size,
        args.val_path, args.device, args.lr, args.seed, args.model_version,
    )


if __name__ == "__main__":
    sys.exit(main())
