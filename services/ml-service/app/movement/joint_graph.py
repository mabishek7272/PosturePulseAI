"""Fixed feature/graph layout shared by tcn_model.py and stgcn_model.py -
the 8 joint-angle channels from app/geometry/kinematics.py's JOINT_ANGLE_DEFS,
in a stable order, plus a simple anatomical adjacency for the ST-GCN block.
"""
from __future__ import annotations

import torch

JOINT_CHANNELS: list[str] = [
    "leftKnee", "rightKnee", "leftHip", "rightHip",
    "leftElbow", "rightElbow", "leftShoulder", "rightShoulder",
]
NUM_CHANNELS = len(JOINT_CHANNELS)

# Anatomically-adjacent pairs (not a learned or validated graph) - connects
# each joint to its ipsilateral neighbor and its contralateral counterpart.
_EDGES = [
    ("leftKnee", "leftHip"), ("rightKnee", "rightHip"),
    ("leftHip", "rightHip"),
    ("leftElbow", "leftShoulder"), ("rightElbow", "rightShoulder"),
    ("leftShoulder", "rightShoulder"),
    ("leftHip", "leftShoulder"), ("rightHip", "rightShoulder"),
]


def build_adjacency_matrix() -> torch.Tensor:
    """Symmetric, self-looped, degree-normalized adjacency - the standard
    ST-GCN normalization (Yan et al. 2018), applied to the fixed joint graph
    above rather than a learned one.
    """
    index = {name: i for i, name in enumerate(JOINT_CHANNELS)}
    adjacency = torch.eye(NUM_CHANNELS)
    for a, b in _EDGES:
        adjacency[index[a], index[b]] = 1.0
        adjacency[index[b], index[a]] = 1.0

    degree = adjacency.sum(dim=1)
    degree_inv_sqrt = torch.diag(degree.pow(-0.5))
    return degree_inv_sqrt @ adjacency @ degree_inv_sqrt


def angles_to_feature_vector(angles: list[dict]) -> list[float]:
    """Maps a CalibratedJointFrame.angles list onto the fixed NUM_CHANNELS
    vector, 0.0 for any channel not present this frame. This zero-fill is an
    internal scaffolding detail of an unvalidated model's input, not a claimed
    measurement - never surfaced as if it were an observed angle.
    """
    by_name = {a["jointName"]: a["thetaRadians"] for a in angles}
    return [by_name.get(name, 0.0) for name in JOINT_CHANNELS]
