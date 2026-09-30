"""Proves ml-service's emitted records validate against BOTH the generated
Pydantic model (already enforced inside app/events/emitter.py) AND the raw JSON
Schema (packages/schemas/src) directly - the same cross-language proof as
packages/schemas/codegen/contract.test.mjs on the TypeScript side. This is what
"single source of truth" actually buys: the Python model and the raw schema
must agree on the same fixture.
"""
import json
from pathlib import Path

import jsonschema

from app.events.emitter import build_pose_landmark_frame, build_quality_gate_flag_validated
from app.pose.landmark_mapper import map_landmarks_to_frame
from app.quality.quality_gate import evaluate_quality
from app.quality.unsupported_state import build_quality_gate_flag

SCHEMAS_SRC = Path(__file__).resolve().parents[3] / "packages" / "schemas" / "src"


def _raw_schema(name: str) -> dict:
    return json.loads((SCHEMAS_SRC / f"{name}.schema.json").read_text())


def _resolver_for(name: str) -> jsonschema.validators.RefResolver:
    common = _raw_schema("common")
    store = {common["$id"]: common}
    schema = _raw_schema(name)
    return jsonschema.validators.RefResolver(base_uri=schema["$id"], referrer=schema, store=store)


def test_pose_landmark_frame_matches_raw_schema():
    landmarks = map_landmarks_to_frame([])  # occluded-everywhere case
    record = build_pose_landmark_frame("s1", "f1", "s1:person-0", landmarks)

    schema = _raw_schema("pose-landmark-frame")
    jsonschema.validate(instance=record, schema=schema, resolver=_resolver_for("pose-landmark-frame"))


def test_quality_gate_flag_matches_raw_schema():
    landmarks = map_landmarks_to_frame([])
    assessment = evaluate_quality(landmarks)
    flag = build_quality_gate_flag_validated(build_quality_gate_flag("s1", "f1", assessment))

    schema = _raw_schema("quality-gate-flag")
    jsonschema.validate(instance=flag, schema=schema, resolver=_resolver_for("quality-gate-flag"))
