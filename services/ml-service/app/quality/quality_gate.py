"""Landmark-confidence/scale/identity/anchor sufficiency checks (PRD 1.6, TRD 2.7).

Only the landmark-sufficiency check is implemented in this phase (no AR
anchoring, no multi-frame identity tracking yet - see docs/hazard-analysis.md
HZ-01/HZ-04). The other reason codes exist in the schema now so those future
checks slot in without a schema change; this module just doesn't populate them.
"""
from __future__ import annotations

from app.config import MIN_OBSERVED_LANDMARKS_FOR_SUPPORTED


def evaluate_quality(landmarks: list[dict]) -> dict:
    observed = [lm for lm in landmarks if lm["observationState"] == "observed"]
    reasons: list[str] = []
    affected_outputs: list[str] = []

    if not observed:
        reasons.append("occlusion")
        affected_outputs.append("pose-landmark-frame")
    elif len(observed) < MIN_OBSERVED_LANDMARKS_FOR_SUPPORTED:
        reasons.append("insufficient_landmarks")

    if reasons:
        affected_outputs.extend(["calibrated-joint-frame", "decisionEvent.cue"])

    state = "unsupported" if reasons else "supported"
    return {"state": state, "reasons": reasons, "affectedOutputs": affected_outputs}
