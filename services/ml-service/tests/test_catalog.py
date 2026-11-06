import json
import re
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.metrics.depth_metrics import DEPTH_METRIC_KEYS
from app.metrics.static_metrics import STATIC_METRICS
from app.versioning import METRICS_VERSION

client = TestClient(app)
REPO = Path(__file__).resolve().parents[3]


def test_catalog_lists_every_registry_metric_with_its_convention():
    resp = client.get("/internal/metrics/catalog")
    assert resp.status_code == 200
    body = resp.json()
    assert body["metricsVersion"] == METRICS_VERSION == "metrics/v2"
    by_key = {m["metricKey"]: m for m in body["metrics"]}
    assert set(by_key) == set(STATIC_METRICS) | set(DEPTH_METRIC_KEYS)
    for key, m in by_key.items():
        assert set(m) == {
            "metricKey", "label", "module", "tier", "unit", "side", "signConvention", "description",
            "measurementMethod",
        }
        expected = "mediapipe_2_5d_depth" if key in DEPTH_METRIC_KEYS else "mediapipe_2d_image_plane"
        assert m["measurementMethod"] == expected
        assert m["module"] == "static"
        assert m["tier"] in ("estimate", "proxy")
        assert m["signConvention"] and m["description"] and m["label"]
    assert by_key["static.knee_frontal_alignment"]["side"] == "left_and_right"
    assert by_key["static.plumb_offset_ear"]["side"] == "near_side"
    assert by_key["static.hip_line_tilt"]["side"] is None


def test_catalog_covers_the_battery_file_metric_keys():
    battery = json.loads((REPO / "references" / "assessment-battery.v0-draft.json").read_text())
    needed = {k for step in battery["steps"] for k in step["metricKeys"]}
    assert needed <= set(STATIC_METRICS)


def test_not_measurable_list_says_what_would_be_needed():
    body = client.get("/internal/metrics/catalog").json()
    items = body["notMeasurable"]
    assert len(items) >= 9
    labels = " ".join(i["label"].lower() for i in items)
    for needle in ("q-angle", "craniovertebral", "forward shoulder", "pelvic tilt", "curvature", "weight distribution",
                   "ground reaction", "joint moment", "muscle activity"):
        assert needle in labels, needle
    for i in items:
        assert set(i) == {"metricKey", "label", "reason", "whatWouldBeNeeded"}
        assert i["reason"] and i["whatWouldBeNeeded"]
        assert i["metricKey"] not in STATIC_METRICS
    assert len({i["metricKey"] for i in items}) == len(items)


def test_catalog_text_has_no_banned_language():
    banned = json.loads((REPO / "references" / "banned-phrases.json").read_text()) if (
        REPO / "references" / "banned-phrases.json"
    ).exists() else []
    text = json.dumps(client.get("/internal/metrics/catalog").json()).lower()
    local = ["diag" + "nos", "normal", "abnormal", "risk", "score", "optimal", "excellent", "perfect", "textbook",
             "poor posture", "bad posture", "good posture", "indicates", "scoliosis", "kyphosis", "lordosis"]
    phrases = [p.lower() for p in (banned if isinstance(banned, list) else banned.get("phrases", []))] + local
    for phrase in phrases:
        assert not re.search(r"\b" + re.escape(phrase), text), phrase
