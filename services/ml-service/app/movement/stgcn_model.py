"""Spatial-Temporal Graph Convolutional Network (Yan et al., AAAI 2018) -
learns joint-level spatial and temporal relationships, per TRD 2.2. Same
honesty framing as tcn_model.py: architecture scaffold only, randomly
initialized, no trained checkpoint, predictions carry no statistical meaning.

Simplified relative to the original paper: operates over the 8 abstract
joint-angle channels from app/movement/joint_graph.py (not raw 2D/3D skeleton
coordinates), with a single fixed anatomical adjacency rather than a learned
or multi-scale graph. This is a scaffold to prove the architecture family's
tensor plumbing works, not a faithful reproduction of the paper.
"""
from __future__ import annotations

import torch
from torch import nn

from app.movement.joint_graph import NUM_CHANNELS, build_adjacency_matrix
from app.movement.tcn_model import CausalTemporalBlock


class GraphConvolution(nn.Module):
    """One spatial graph convolution: X' = A_hat @ X @ W (Yan et al. 2018's
    simplified spectral formulation), applied independently at each timestep.
    """

    def __init__(self, channels: int) -> None:
        super().__init__()
        self.register_buffer("adjacency", build_adjacency_matrix())
        self.weight = nn.Conv1d(channels, channels, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: [batch, NUM_CHANNELS, T]."""
        mixed = torch.einsum("ij,bjt->bit", self.adjacency, x)
        return self.weight(mixed)


class STGCNBlock(nn.Module):
    def __init__(self, channels: int, dilation: int) -> None:
        super().__init__()
        self.spatial = GraphConvolution(channels)
        self.temporal = CausalTemporalBlock(channels, dilation=dilation)
        self.activation = nn.ReLU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.activation(self.spatial(x)) + x
        return self.temporal(x)


class STGCNPhaseClassifier(nn.Module):
    def __init__(self, num_classes: int, num_channels: int = NUM_CHANNELS, num_blocks: int = 2) -> None:
        super().__init__()
        self.blocks = nn.ModuleList(
            [STGCNBlock(num_channels, dilation=2**i) for i in range(num_blocks)]
        )
        self.head = nn.Linear(num_channels, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: [batch, NUM_CHANNELS, T] -> logits: [batch, num_classes]."""
        for block in self.blocks:
            x = block(x)
        pooled = x.mean(dim=2)
        return self.head(pooled)
