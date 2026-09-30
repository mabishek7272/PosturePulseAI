"""End-to-end HTTP round trip through the real FastAPI app (per the
implementation plan's verification section: "ml-service round trip: POST an
occluded fixture -> assert quality_gate_flag.state == 'unsupported'"). Uses the
real downloaded model - skipped if it hasn't been fetched yet.
"""
import base64

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import POSE_LANDMARKER_MODEL_PATH
from app.main import app

pytestmark = pytest.mark.skipif(
    not POSE_LANDMARKER_MODEL_PATH.exists(),
    reason=f"Pose landmarker model not found at {POSE_LANDMARKER_MODEL_PATH} - run scripts/fetch-pose-model.sh first.",
)

client = TestClient(app)


def _encode_jpeg(arr: np.ndarray) -> str:
    ok, buf = cv2.imencode(".jpg", arr)
    assert ok
    return base64.b64encode(buf.tobytes()).decode()


def test_health():
    resp = client.get("/internal/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_no_person_image_round_trip_is_unsupported():
    arr = (np.random.rand(480, 640, 3) * 255).astype(np.uint8)
    resp = client.post(
        "/internal/frames",
        json={
            "sessionId": "s1",
            "frameId": "f1",
            "capturedAt": "2026-01-01T00:00:00Z",
            "imageBase64": _encode_jpeg(arr),
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["qualityGateFlag"]["state"] == "unsupported"
    assert "occlusion" in data["qualityGateFlag"]["reasons"]
    assert len(data["poseLandmarkFrame"]["landmarks"]) == 33
    assert all(lm["observationState"] == "occluded" for lm in data["poseLandmarkFrame"]["landmarks"])
    # No observed landmarks -> zero computable angles -> no fabricated CalibratedJointFrame.
    assert data["calibratedJointFrame"] is None


def test_invalid_base64_is_rejected():
    resp = client.post(
        "/internal/frames",
        json={
            "sessionId": "s1",
            "frameId": "f1",
            "capturedAt": "2026-01-01T00:00:00Z",
            "imageBase64": "not valid base64!!!",
        },
    )
    assert resp.status_code == 400
