"""Temporal Convolutional Network - the efficient temporal baseline named in
TRD 2.2. Architecture scaffold only: weights are randomly initialized here
and this module never loads a trained checkpoint (none exists - see
train_entry_point.py). Predictions carry no statistical meaning until
trained on a labeled dataset this sandbox does not have - see
movement-phase-event.schema.json's `validated: false` and
docs/adr/005-deterministic-policy-engine.md for why this never drives a
safety decision.
"""
from __future__ import annotations

import torch
from torch import nn

from app.movement.joint_graph import NUM_CHANNELS


class CausalTemporalBlock(nn.Module):
    """One dilated causal 1D convolution + residual connection."""

    def __init__(self, channels: int, dilation: int, kernel_size: int = 3) -> None:
        super().__init__()
        # Causal: pad only on the left so output[t] never depends on input[t+1:].
        self.padding = (kernel_size - 1) * dilation
        self.conv = nn.Conv1d(channels, channels, kernel_size, dilation=dilation, padding=self.padding)
        self.activation = nn.ReLU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = self.conv(x)
        out = out[:, :, : -self.padding] if self.padding > 0 else out  # trim the right-side padding conv1d added
        return self.activation(out) + x


class TCNPhaseClassifier(nn.Module):
    def __init__(self, num_classes: int, num_channels: int = NUM_CHANNELS, num_blocks: int = 3) -> None:
        super().__init__()
        self.blocks = nn.ModuleList(
            [CausalTemporalBlock(num_channels, dilation=2**i) for i in range(num_blocks)]
        )
        self.head = nn.Linear(num_channels, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: [batch, NUM_CHANNELS, T] -> logits: [batch, num_classes]."""
        for block in self.blocks:
            x = block(x)
        pooled = x.mean(dim=2)  # global average pool over time
        return self.head(pooled)
