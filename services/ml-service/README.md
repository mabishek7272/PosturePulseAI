# ml-service

Pose estimation, kinematics, and quality gating - the AI/system side of beAIve,
running server-side per the product's architecture decision (see root
`README.md` and `docs/adr/`).

## Setup

```bash
# From services/ml-service/
python3 -m pip install -e .
python3 -m pip install -e ../../packages/schemas/generated/python   # beaive-schemas
python3 -m pip install -e ".[dev]"                                   # pytest, httpx, jsonschema

# Download the MediaPipe Tasks Pose Landmarker model bundle (not committed -
# it's a ~5.6MB binary asset with its own license). Not required to run the
# unit tests for geometry/quality-gate/mapper logic, but required for the
# adapter/HTTP-round-trip tests and for actually serving /internal/frames.
bash scripts/fetch-pose-model.sh
```

## Run

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Test

```bash
pytest
```

Tests that need the real model (`test_mediapipe_adapter.py`,
`test_internal_routes.py`) skip themselves with a clear reason if
`scripts/fetch-pose-model.sh` hasn't been run yet, rather than failing opaquely.

## What's real vs. stubbed in this phase

- **Real**: MediaPipe Tasks PoseLandmarker inference, landmark-to-canonical-joint
  mapping, the quality gate's "no person / insufficient landmarks" path, the
  joint-angle math (`app/geometry/kinematics.py`), and schema validation against
  the generated Pydantic models (`beaive_schemas`) - all covered by tests that
  exercise the actual code paths, including a genuine HTTP round trip with a
  real (no-person) image through the real model.
- **Known gap, documented in `docs/traceability-matrix.md`**: there is no real
  scale/reprojection check, so `CalibratedJointFrame.scaleValidated` would
  always be `False` if that record were wired into the live API response (it
  isn't yet - see the comment in `app/api/internal_routes.py`). There is also no
  real "supported, high-confidence, multi-repetition" test fixture, because that
  requires an actual photo/video of a person, which this scaffolding phase does
  not include; the quality-gate "supported" branch and the kinematics math are
  instead proven with synthetic landmark data directly (see
  `tests/test_quality_gate.py`, `tests/test_kinematics.py`), which is honest
  about what has and hasn't been validated against real footage.
