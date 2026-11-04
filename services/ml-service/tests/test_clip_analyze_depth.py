"""POST /internal/clips/analyze with a depth track (ADR-020, Phase 1).

The binding property of this phase: **depth changes nothing**. It is transported,
decoded and reported as transport-health reporting, and every metric value, tier,
provenance field and quality flag is identical to what the same clip produced
before depth existed. These tests are what makes that claim checkable rather
than asserted - the structural invariant in ADR-020's Consequences ("a depth
failure suppresses only static3d.* keys and can never degrade a 2D result") is
only trustworthy if something fails when it is broken.
"""
from __future__ import annotations

import hashlib

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api.clip_routes import get_observation_loader
from app.clips.observation import FrameObservation
from app.main import app
from clip_helpers import request_body, sidecar
from depth_helpers import depth_sidecar_block, encode_depth_file, flat_depth_mm
from synthetic_pose import anterior_pose, make_frames

client = TestClient(app)


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIP_DIR", str(tmp_path))
    clip = tmp_path / "clip-1.mov"
    clip.write_bytes(b"not really a video")
    app.dependency_overrides[get_observation_loader] = lambda: (
        lambda path, side: make_frames(anterior_pose(), n=len(side.frames))
    )
    yield tmp_path, clip
    app.dependency_overrides.clear()


def _with_depth(tmp_path, *, frames_mm=None, **block_overrides):
    """A sidecar with a depth block, plus the matching file's path."""
    frames_mm = frames_mm if frames_mm is not None else [flat_depth_mm(2.5, valid=0.9) for _ in range(5)]
    path = encode_depth_file(tmp_path / "clip-1.depth", frames_mm)
    side = sidecar()
    side["depth"] = depth_sidecar_block(path, frames_mm, **block_overrides)
    return side, path


def _metric_values(body):
    """Everything about the 2D results that depth must not touch."""
    return [
        (r["metricKey"], r["side"], r["tier"], r.get("estimate"), r.get("unsupported"), r["provenance"]["measurementMethod"])
        for r in body["results"]
    ]


def test_a_clip_with_no_depth_gets_no_depth_block_at_all(env):
    _, clip = env
    body = client.post("/internal/clips/analyze", json=request_body(str(clip))).json()
    # Absent, not null or empty: the response is the one this endpoint returned
    # before ADR-020 existed.
    assert "depth" not in body


def test_depth_is_decoded_and_reported_as_health_only(env):
    tmp_path, clip = env
    side, depth_path = _with_depth(tmp_path)
    side["intrinsics"] = {"fx": 1000.0, "fy": 1000.0, "cx": 539.5, "cy": 959.5}

    body = client.post(
        "/internal/clips/analyze",
        json=request_body(str(clip), side=side, depthPath=str(depth_path)),
    ).json()

    depth = body["depth"]
    assert depth["state"] == "decoded"
    assert depth["frameCount"] == 5
    assert depth["width"] == 256 and depth["height"] == 192
    assert depth["validSampleFraction"] == pytest.approx(0.9, abs=0.01)
    assert depth["intrinsicsPresent"] is True
    assert depth["medianHipDepthMetres"] == pytest.approx(2.5, abs=0.02)

    # No depth-derived metric, no new key, no changed method.
    assert not any(r["metricKey"].startswith("static3d.") for r in body["results"])
    assert {r["provenance"]["measurementMethod"] for r in body["results"]} == {"mediapipe_2d_image_plane"}
    for r in body["results"]:
        assert "depth" not in r and "depth" not in r["provenance"]


def test_every_metric_value_is_unchanged_by_the_presence_of_depth(env):
    """The Phase 1 gate. Same clip, same pose loader, once without depth and once
    with: the 2D results must be identical field for field."""
    tmp_path, clip = env
    without = client.post("/internal/clips/analyze", json=request_body(str(clip))).json()

    side, depth_path = _with_depth(tmp_path)
    side["intrinsics"] = {"fx": 1000.0, "fy": 1000.0, "cx": 539.5, "cy": 959.5}
    with_depth = client.post(
        "/internal/clips/analyze",
        json=request_body(str(clip), side=side, depthPath=str(depth_path)),
    ).json()

    assert _metric_values(with_depth) == _metric_values(without)
    assert with_depth["frameQuality"] == without["frameQuality"]
    assert with_depth["landmarkSeries"]["sha256"] == without["landmarkSeries"]["sha256"]


@pytest.mark.parametrize(
    "mangle,state,needle",
    [
        ("corrupt", "unreadable", "sha256"),
        ("delete", "unreadable", "not found"),
        ("count", "unreadable", "frameCount"),
    ],
)
def test_a_broken_depth_track_never_degrades_the_2d_result(env, mangle, state, needle):
    """A depth failure is a reported condition, not a clip failure. A clip whose video
    analysed perfectly must still return its estimates."""
    tmp_path, clip = env
    clean = client.post("/internal/clips/analyze", json=request_body(str(clip))).json()

    if mangle == "count":
        side, depth_path = _with_depth(tmp_path, frameCount=450)
    else:
        side, depth_path = _with_depth(tmp_path)
        if mangle == "corrupt":
            encode_depth_file(depth_path, [flat_depth_mm(1.0)])  # well-formed, wrong bytes
        else:
            depth_path.unlink()

    body = client.post(
        "/internal/clips/analyze",
        json=request_body(str(clip), side=side, depthPath=str(depth_path)),
    ).json()

    assert body["depth"]["state"] == state
    assert needle in body["depth"]["error"]
    assert _metric_values(body) == _metric_values(clean)
    assert all("estimate" in r for r in body["results"])


def test_a_declared_depth_track_with_no_path_is_reported_not_invented(env):
    tmp_path, clip = env
    side, _ = _with_depth(tmp_path)
    body = client.post("/internal/clips/analyze", json=request_body(str(clip), side=side)).json()
    assert body["depth"] == {
        "state": "missing",
        "error": "the sidecar declares a depth track but no depthPath was supplied",
    }
    assert all("estimate" in r for r in body["results"])


def test_an_undeclared_depth_file_is_left_unread(env):
    """With no encoding, scale or timing to read it by, the file stays unread
    rather than being decoded under an assumed format."""
    tmp_path, clip = env
    frames_mm = [flat_depth_mm(2.5)]
    path = encode_depth_file(tmp_path / "clip-1.depth", frames_mm)
    body = client.post(
        "/internal/clips/analyze", json=request_body(str(clip), depthPath=str(path))
    ).json()
    assert body["depth"]["state"] == "undeclared"
    assert all("estimate" in r for r in body["results"])


def test_a_depth_path_outside_the_clip_directory_is_refused(env, tmp_path):
    """Containment is a request-level rule, like clipPath's: refused loudly with
    a 400 rather than degraded into "no depth"."""
    _, clip = env
    side, _ = _with_depth(tmp_path)
    resp = client.post(
        "/internal/clips/analyze",
        json=request_body(str(clip), side=side, depthPath="/etc/passwd"),
    )
    assert resp.status_code == 400
    assert "clip directory" in resp.text


def test_depth_without_intrinsics_still_decodes_but_reports_none(env):
    """Most clips have no intrinsics. The track is still readable; what is absent
    is the camera, and a camera is never invented (a guessed fx is a guessed
    metric scale)."""
    tmp_path, clip = env
    side, depth_path = _with_depth(tmp_path)
    body = client.post(
        "/internal/clips/analyze",
        json=request_body(str(clip), side=side, depthPath=str(depth_path)),
    ).json()
    assert body["depth"]["state"] == "decoded"
    assert body["depth"]["intrinsicsPresent"] is False
    assert "intrinsics" not in body["depth"]
    # The hip depth does not need intrinsics - only the pixel grid mapping does.
    assert body["depth"]["medianHipDepthMetres"] == pytest.approx(2.5, abs=0.02)


def test_the_depth_track_is_hashed_against_the_sidecar_before_it_is_decoded(env):
    """Belt-and-braces with the backend's own check: a swapped track must not be
    readable as plausible millimetres on either side of the boundary."""
    tmp_path, clip = env
    frames_mm = [flat_depth_mm(2.5)]
    path = encode_depth_file(tmp_path / "clip-1.depth", frames_mm)
    side = sidecar()
    side["depth"] = depth_sidecar_block(path, frames_mm)
    side["depth"]["sha256"] = hashlib.sha256(b"something else entirely").hexdigest()

    body = client.post(
        "/internal/clips/analyze",
        json=request_body(str(clip), side=side, depthPath=str(path)),
    ).json()
    assert body["depth"]["state"] == "unreadable"
    assert "sha256" in body["depth"]["error"]


def test_a_clip_with_no_pose_reports_depth_health_without_a_hip_depth(env, monkeypatch):
    """Depth can arrive intact while the pose model finds nothing. The transport
    health block still reports, but with no landmark to sample at there is no hip
    depth rather than one taken at a guessed location."""
    tmp_path, clip = env
    app.dependency_overrides[get_observation_loader] = lambda: (
        lambda path, side: [
            # points stays None: no pose was detected, and nothing is filled in.
            FrameObservation(index=f.index, t=f.t, gravity=tuple(f.gravity))
            for f in side.frames
        ]
    )
    side, depth_path = _with_depth(tmp_path)
    body = client.post(
        "/internal/clips/analyze",
        json=request_body(str(clip), side=side, depthPath=str(depth_path)),
    ).json()
    assert body["depth"]["state"] == "decoded"
    assert body["depth"]["validSampleFraction"] > 0
    assert "medianHipDepthMetres" not in body["depth"]


def test_an_unknown_depth_encoding_is_refused_at_the_request_boundary(env, tmp_path):
    """`encoding` is an enum in clip-capture.schema.json, so an unrecognised
    value never reaches the decoder: the generated ClipCapture model rejects the
    whole request with a 422. That is the intended place for it to fail - a
    free-text encoding would otherwise have been read as millimetres. The
    behaviour is asserted here so that making the field permissive again would
    break a test rather than silently change how bytes are interpreted."""
    _, clip = env
    side, depth_path = _with_depth(tmp_path, encoding="float32_raw")
    resp = client.post(
        "/internal/clips/analyze",
        json=request_body(str(clip), side=side, depthPath=str(depth_path)),
    )
    assert resp.status_code == 422
    assert "encoding" in resp.text
