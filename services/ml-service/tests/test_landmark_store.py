import gzip
import hashlib
import json

import numpy as np
import pytest

from app.clips.landmark_store import store_landmark_series
from synthetic_pose import anterior_pose, empty_frames, make_frames


def test_series_is_gzip_json_with_a_matching_sha256(tmp_path):
    frames = make_frames(anterior_pose(), n=3)
    info = store_landmark_series(
        tmp_path, clip_id="clip-1", session_id="s", step_id="static.anterior", view="anterior",
        width=1080, height=1920, model_version="mediapipe-pose-full/x", observations=frames,
    )
    assert info["path"] == str(tmp_path / "landmarks" / "clip-1.json.gz")
    data = (tmp_path / "landmarks" / "clip-1.json.gz").read_bytes()
    assert info["sha256"] == hashlib.sha256(data).hexdigest()
    body = json.loads(gzip.decompress(data))
    assert body["clipId"] == "clip-1" and body["modelVersion"] == "mediapipe-pose-full/x"
    assert body["width"] == 1080 and len(body["frames"]) == 3
    f0 = body["frames"][0]
    assert len(f0["points"]) == 33 and len(f0["points"][0]) == 2 and len(f0["visibility"]) == 33
    assert f0["gravity"] == [0.0, 1.0, 0.0] and f0["t"] == 0.0


def test_frames_without_a_pose_store_null_not_zeros(tmp_path):
    info = store_landmark_series(
        tmp_path, clip_id="c", session_id="s", step_id="x", view="anterior",
        width=10, height=10, model_version="m", observations=empty_frames(2),
    )
    body = json.loads(gzip.decompress(open(info["path"], "rb").read()))
    assert body["frames"][0]["points"] is None and body["frames"][0]["visibility"] is None


def test_same_input_gives_the_same_bytes(tmp_path):
    kwargs = dict(clip_id="c", session_id="s", step_id="x", view="anterior", width=10, height=10,
                  model_version="m", observations=make_frames(anterior_pose(), n=2))
    a = store_landmark_series(tmp_path / "a", **kwargs)
    b = store_landmark_series(tmp_path / "b", **kwargs)
    assert a["sha256"] == b["sha256"]


@pytest.mark.parametrize("bad", ["../x", "a/b", "", ".hidden", "a b"])
def test_unsafe_clip_ids_are_refused(tmp_path, bad):
    with pytest.raises(ValueError):
        store_landmark_series(
            tmp_path, clip_id=bad, session_id="s", step_id="x", view="anterior", width=1, height=1,
            model_version="m", observations=[],
        )


def test_temp_file_name_is_unique_and_no_part_file_is_left_behind(tmp_path, monkeypatch):
    import pathlib

    seen = []
    real = pathlib.Path.replace

    def spy(self, target):
        seen.append(self.name)
        return real(self, target)

    monkeypatch.setattr(pathlib.Path, "replace", spy)
    kwargs = dict(clip_id="c", session_id="s", step_id="x", view="anterior", width=10, height=10,
                  model_version="m", observations=make_frames(anterior_pose(), n=2))
    store_landmark_series(tmp_path, **kwargs)
    store_landmark_series(tmp_path, **kwargs)
    assert len(seen) == 2 and seen[0] != seen[1]
    assert [p.name for p in (tmp_path / "landmarks").iterdir()] == ["c.json.gz"]
