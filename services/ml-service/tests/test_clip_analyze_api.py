"""POST /internal/clips/analyze with a stand-in pose loader (no model, no real
video): the request/response contract, provenance, storage and error handling."""
import gzip
import hashlib
import json
from pathlib import Path

import jsonschema
import pytest
from fastapi.testclient import TestClient

from app.api.clip_routes import get_observation_loader
from app.clips.errors import ClipDecodeError
from app.main import app
from app.versioning import CLIP_MODEL_VERSION, METRICS_VERSION
from clip_helpers import ANTERIOR_KEYS, request_body, sidecar
from synthetic_pose import anterior_pose, make_frames

SCHEMAS_SRC = Path(__file__).resolve().parents[3] / "packages" / "schemas" / "src"


def _validator():
    common = json.loads((SCHEMAS_SRC / "common.schema.json").read_text())
    qgf = json.loads((SCHEMAS_SRC / "quality-gate-flag.schema.json").read_text())
    schema = json.loads((SCHEMAS_SRC / "metric-result.schema.json").read_text())
    store = {common["$id"]: common, qgf["$id"]: qgf}
    resolver = jsonschema.validators.RefResolver(base_uri=schema["$id"], referrer=schema, store=store)
    return jsonschema.Draft202012Validator(schema, resolver=resolver, format_checker=jsonschema.FormatChecker())


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIP_DIR", str(tmp_path))
    clip = tmp_path / "clip-1.mov"
    clip.write_bytes(b"not really a video")
    loaders = {"fn": lambda path, side: make_frames(anterior_pose(), n=len(side.frames))}
    app.dependency_overrides[get_observation_loader] = lambda: (lambda p, s: loaders["fn"](p, s))
    yield tmp_path, clip, loaders
    app.dependency_overrides.clear()


client = TestClient(app)


def test_every_requested_key_gets_one_schema_valid_result_with_provenance(env):
    tmp_path, clip, _ = env
    resp = client.post("/internal/clips/analyze", json=request_body(str(clip)))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    results = body["results"]
    assert [(r["metricKey"], r["side"]) for r in results] == [(k, None) for k in ANTERIOR_KEYS[:5]] + [
        ("static.knee_frontal_alignment", "left"),
        ("static.knee_frontal_alignment", "right"),
    ]
    validator = _validator()
    sha = hashlib.sha256(clip.read_bytes()).hexdigest()
    for r in results:
        validator.validate(r)
        assert "estimate" in r and "unsupported" not in r
        assert r["sessionId"] == "sess-1" and r["clipId"] == "clip-1" and r["stepId"] == "static.anterior"
        assert r["module"] == "static" and r["estimate"]["signConvention"]
        assert r["estimate"]["uncertainty"] > 0 and r["estimate"]["framesUsed"] == 30
        prov = r["provenance"]
        assert prov["schemaVersion"] == "metric-result/v0"
        assert prov["modelVersion"] == CLIP_MODEL_VERSION
        assert prov["metricsVersion"] == METRICS_VERSION
        assert prov["clipSha256"] == sha
        assert prov["calibrationVersion"] == "none/v0"
        assert prov["measurementMethod"] == "mediapipe_2d_image_plane"
        assert r["evidence"]["landmarkSeriesSha256"] == body["landmarkSeries"]["sha256"]
    assert len({r["resultId"] for r in results}) == len(results)
    assert body["frameQuality"] == {"usable": 30, "total": 30, "reasons": []}


def test_landmark_series_is_stored_on_the_shared_volume(env):
    tmp_path, clip, _ = env
    body = client.post("/internal/clips/analyze", json=request_body(str(clip))).json()
    series = body["landmarkSeries"]
    assert series["path"] == str(tmp_path / "landmarks" / "clip-1" / f"{series['sha256']}.json.gz")
    data = Path(series["path"]).read_bytes()
    assert hashlib.sha256(data).hexdigest() == series["sha256"]
    stored = json.loads(gzip.decompress(data))
    assert stored["clipId"] == "clip-1" and len(stored["frames"]) == 60


def test_relative_clip_path_resolves_against_the_clip_dir(env):
    _, clip, _ = env
    resp = client.post("/internal/clips/analyze", json=request_body(clip.name))
    assert resp.status_code == 200


def test_quality_failure_gives_unsupported_for_every_key(env):
    _, clip, loaders = env
    from synthetic_pose import empty_frames

    loaders["fn"] = lambda p, s: empty_frames(len(s.frames))
    body = client.post("/internal/clips/analyze", json=request_body(str(clip))).json()
    assert len(body["results"]) == 7
    validator = _validator()
    for r in body["results"]:
        validator.validate(r)
        assert "estimate" not in r
        assert "insufficient_frames" in r["unsupported"]["reasons"]
    assert body["frameQuality"]["usable"] == 0
    assert "insufficient_frames" in body["frameQuality"]["reasons"]


def test_decode_failure_is_unsupported_not_an_error(env):
    _, clip, loaders = env

    def boom(path, side):
        raise ClipDecodeError("corrupt")

    loaders["fn"] = boom
    resp = client.post("/internal/clips/analyze", json=request_body(str(clip)))
    assert resp.status_code == 200
    body = resp.json()
    validator = _validator()
    assert len(body["results"]) == 7
    for r in body["results"]:
        validator.validate(r)
        assert r["unsupported"]["reasons"] == ["insufficient_frames"]
    assert body["frameQuality"] == {"usable": 0, "total": 0, "reasons": ["insufficient_frames"]}
    assert Path(body["landmarkSeries"]["path"]).exists()


def test_unknown_metric_key_is_422(env):
    _, clip, _ = env
    resp = client.post("/internal/clips/analyze", json=request_body(str(clip), keys=["static.nope"]))
    assert resp.status_code == 422


def test_sidecar_that_does_not_match_the_request_is_422(env):
    _, clip, _ = env
    body = request_body(str(clip))
    body["sidecar"]["clipId"] = "other"
    assert client.post("/internal/clips/analyze", json=body).status_code == 422
    body = request_body(str(clip))
    body["stepId"] = "static.posterior"
    assert client.post("/internal/clips/analyze", json=body).status_code == 422


def test_clip_outside_the_clip_dir_is_refused(env, tmp_path_factory):
    outside = tmp_path_factory.mktemp("outside") / "x.mov"
    outside.write_bytes(b"x")
    assert client.post("/internal/clips/analyze", json=request_body(str(outside))).status_code == 400
    assert client.post("/internal/clips/analyze", json=request_body("../x.mov")).status_code == 400


def test_missing_clip_file_is_404(env):
    assert client.post("/internal/clips/analyze", json=request_body("nope.mov")).status_code == 404


def test_frames_endpoint_is_still_routed():
    assert client.get("/internal/health").json() == {"status": "ok"}
    paths = client.get("/openapi.json").json()["paths"]
    assert "/internal/frames" in paths and "/internal/clips/analyze" in paths
