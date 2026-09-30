"""Runs a window of CalibratedJointFrame angle vectors through the selected
model (config-selectable, default TCN) and returns a MovementPhaseEvent-
shaped dict. `validated` is ALWAYS False here in code - belt-and-suspenders
alongside movement-phase-event.schema.json's `"const": false` - this is
descriptive/exposure-analytics output only and must never be cited as
evidence for a safety-relevant DecisionEvent (docs/adr/005).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import torch

from app.movement.joint_graph import angles_to_feature_vector
from app.movement.stgcn_model import STGCNPhaseClassifier
from app.movement.tcn_model import TCNPhaseClassifier

# Hard-coded, matching this phase's belt-and-suspenders check.
MOVEMENT_MODEL_VALIDATED_THIS_PHASE = False

PHASE_LABELS = ["descend", "hold", "ascend", "unknown"]

_tcn_model = TCNPhaseClassifier(num_classes=len(PHASE_LABELS))
_stgcn_model = STGCNPhaseClassifier(num_classes=len(PHASE_LABELS))
_tcn_model.eval()
_stgcn_model.eval()


def run_movement_window(
    session_id: str,
    exercise_id: str,
    window_start_at: str,
    window_end_at: str,
    joint_angle_sequence: list[list[dict]],
    source_frame_ids: list[str],
    model_architecture: str = "tcn",
) -> dict:
    """`joint_angle_sequence`: one CalibratedJointFrame.angles list per
    timestep in the window. `source_frame_ids`: the corresponding
    CalibratedJointFrame ids, used as evidence refs.
    """
    if model_architecture not in ("tcn", "st-gcn"):
        raise ValueError(f"Unknown model_architecture '{model_architecture}' - expected 'tcn' or 'st-gcn'.")
    if not joint_angle_sequence:
        raise ValueError("joint_angle_sequence must not be empty.")

    features = [angles_to_feature_vector(angles) for angles in joint_angle_sequence]
    # [1, NUM_CHANNELS, T]
    x = torch.tensor(features, dtype=torch.float32).transpose(0, 1).unsqueeze(0)

    model = _tcn_model if model_architecture == "tcn" else _stgcn_model
    with torch.no_grad():
        logits = model(x)
        probabilities = torch.softmax(logits, dim=1)[0]
        top_index = int(torch.argmax(probabilities).item())

    return {
        "movementPhaseEventId": str(uuid.uuid4()),
        "sessionId": session_id,
        "exerciseId": exercise_id,
        "windowStartAt": window_start_at,
        "windowEndAt": window_end_at,
        "modelArchitecture": model_architecture,
        "validated": MOVEMENT_MODEL_VALIDATED_THIS_PHASE,
        "predictedPhase": PHASE_LABELS[top_index],
        "phaseConfidence": float(probabilities[top_index].item()),
        # Rep counting is the deterministic policy engine's job
        # (services/backend-api/src/policy/rep-counter.service.ts) - this
        # untrained model never duplicates or overrides that, so it always
        # reports 0 here rather than fabricating a count.
        "repCountDelta": 0,
        "evidence": [{"type": "calibrated-joint-frame", "refId": ref_id} for ref_id in source_frame_ids],
        "provenance": {
            "schemaVersion": "movement-phase-event/v0",
            "modelVersion": f"{model_architecture}-untrained/v0",
            "calibrationVersion": "none/v0",
            "producedAt": datetime.now(timezone.utc).isoformat(),
        },
    }
