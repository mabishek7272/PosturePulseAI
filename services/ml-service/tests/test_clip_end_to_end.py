"""Real PyAV decode + real PoseLandmarker (full, VIDEO mode) on a synthetic
video that contains no person. The honest outcome is all-unsupported."""
import fractions
from pathlib import Path

import av
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.clips.errors import ClipDecodeError
from app.clips.pose_video import apply_rotation, load_observations
from app.config import POSE_LANDMARKER_FULL_MODEL_PATH
from app.main import app
from beaive_schemas import ClipCapture
from clip_helpers import ANTERIOR_KEYS, request_body, sidecar

needs_model = pytest.mark.skipif(
    not POSE_LANDMARKER_FULL_MODEL_PATH.exists(),
    reason=f"full pose model not found at {POSE_LANDMARKER_FULL_MODEL_PATH} - run scripts/fetch-pose-model.sh",
)

W, H, N, FPS = 270, 480, 45, 30


def write_video(path: Path, width: int = W, height: int = H, frames: int = N, codec: str = "libx264") -> None:
    rng = np.random.default_rng(0)
    with av.open(str(path), "w") as container:
        stream = container.add_stream(codec, rate=FPS)
        stream.width, stream.height, stream.pix_fmt = width, height, "yuv420p"
        for i in range(frames):
            gradient = np.linspace(0, 255, width, dtype=np.uint8)[None, :, None].repeat(height, 0).repeat(3, 2)
            noise = rng.integers(0, 40, size=(height, width, 3), dtype=np.uint8)
            frame = av.VideoFrame.from_ndarray(np.clip(gradient // 2 + noise, 0, 255).astype(np.uint8), format="rgb24")
            frame.pts = i
            frame.time_base = fractions.Fraction(1, FPS)
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def test_apply_rotation_follows_the_display_matrix():
    arr = np.arange(6).reshape(2, 3)
    assert apply_rotation(arr, 0).shape == (2, 3)
    assert apply_rotation(arr, 90).tolist() == np.rot90(arr, 1).tolist()  # counterclockwise
    assert apply_rotation(arr, -90).tolist() == np.rot90(arr, 3).tolist()
    assert apply_rotation(arr, 180).tolist() == np.rot90(arr, 2).tolist()
    with pytest.raises(ClipDecodeError):
        apply_rotation(arr, 45)


@needs_model
@pytest.mark.parametrize("codec,suffix", [("libx264", "mp4"), ("libx265", "mov")])
def test_loader_yields_one_observation_per_sidecar_frame_without_inventing_a_pose(tmp_path, codec, suffix):
    if codec not in av.codecs_available:
        pytest.skip(f"{codec} encoder not available in this PyAV build")
    clip = tmp_path / f"clip-1.{suffix}"
    write_video(clip, codec=codec)
    side = ClipCapture.model_validate(sidecar(n=N, width=W, height=H))
    observations = load_observations(clip, side)
    assert len(observations) == N
    assert [o.index for o in observations] == list(range(N))
    assert all(o.points is None and o.visibility is None for o in observations)


@needs_model
def test_end_to_end_no_person_gives_all_unsupported(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIP_DIR", str(tmp_path))
    clip = tmp_path / "clip-1.mp4"
    write_video(clip)
    body = request_body(str(clip), sidecar(n=N, width=W, height=H))
    resp = TestClient(app).post("/internal/clips/analyze", json=body)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert len(data["results"]) == 7
    for r in data["results"]:
        assert "estimate" not in r
        assert "insufficient_frames" in r["unsupported"]["reasons"]
    assert data["frameQuality"]["usable"] == 0
    assert Path(data["landmarkSeries"]["path"]).exists()


@needs_model
def test_a_clip_whose_size_disagrees_with_the_sidecar_is_unsupported_not_guessed(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIP_DIR", str(tmp_path))
    clip = tmp_path / "clip-1.mp4"
    write_video(clip, width=H, height=W)  # sideways relative to the sidecar
    body = request_body(str(clip), sidecar(n=N, width=W, height=H))
    data = TestClient(app).post("/internal/clips/analyze", json=body).json()
    assert [r["unsupported"]["reasons"] for r in data["results"]] == [["insufficient_frames"]] * 7


@needs_model
def test_a_file_that_is_not_a_video_is_unsupported_not_an_error(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIP_DIR", str(tmp_path))
    clip = tmp_path / "clip-1.mov"
    clip.write_bytes(b"\x00" * 2048)
    body = request_body(str(clip), sidecar(n=N, width=W, height=H), keys=ANTERIOR_KEYS)
    resp = TestClient(app).post("/internal/clips/analyze", json=body)
    assert resp.status_code == 200
    assert all(r["unsupported"]["reasons"] == ["insufficient_frames"] for r in resp.json()["results"])
