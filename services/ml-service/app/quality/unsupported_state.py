"""Builds the QualityGateFlag record shape from a quality_gate.evaluate_quality()
assessment. Kept separate from quality_gate.py so "decide whether this frame is
supported" and "build the schema record for that decision" are independently
testable and reusable.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone


def build_quality_gate_flag(session_id: str, frame_id: str, assessment: dict) -> dict:
    return {
        "flagId": str(uuid.uuid4()),
        "sessionId": session_id,
        "frameId": frame_id,
        "evaluatedAt": datetime.now(timezone.utc).isoformat(),
        "state": assessment["state"],
        "reasons": assessment["reasons"],
        "affectedOutputs": assessment["affectedOutputs"],
    }
