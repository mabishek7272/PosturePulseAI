"""app/clips/face_video.py - picking the rigid cranio-orbital points, and the
gate that makes an unverified index mapping safe to run.

No model file is needed: MediaPipe's Face Landmarker bundle is a multi-megabyte
asset fetched by `scripts/fetch-pose-model.sh` and `.models/` is gitignored, so
these tests inject a mesh the way `test_clip_analyze_api.py` injects pose
observations. What is NOT tested here is whether the published mesh indices are
the anatomical points they are labelled as - that needs the model and real
captures, and the reprojection gate below is what stands in for it.
"""
from __future__ import annotations

import itertools

import numpy as np
import pytest

from app.clips.face_video import (
    CRANIO_ORBITAL_INDICES,
    FACE_VIEWS,
    MAX_RMS_REPROJECTION_PX,
    cranio_orbital_from_mesh,
    load_face_frames,
    model_available,
)
from app.geometry.head_pose import (
    CANONICAL_LANDMARKS_MM,
    RIGID_SIX,
    head_pose_from_landmarks,
    project,
    solve_rigid_pose,
)
from app.geometry.intrinsics import CameraIntrinsics

K = CameraIntrinsics(fx=1000.0, fy=1000.0, cx=539.5, cy=719.5, width=1080, height=1440)
LEVEL = (0.0, 1.0, 0.0)
POINTS = np.array([CANONICAL_LANDMARKS_MM[n] for n in RIGID_SIX])


def rotation_vector(r: np.ndarray) -> np.ndarray:
    theta = float(np.arccos(np.clip((np.trace(r) - 1) / 2, -1.0, 1.0)))
    if theta < 1e-9:
        return np.zeros(3)
    axis = np.array([r[2, 1] - r[1, 2], r[0, 2] - r[2, 0], r[1, 0] - r[0, 1]])
    return axis / (2 * np.sin(theta)) * theta


def observed(roll=6.0, pitch=-4.0, yaw=5.0, *, noise=0.0, seed=0) -> dict[str, tuple[float, float]]:
    rr, rp, ry = np.radians([roll, pitch, yaw])
    rz = np.array([[np.cos(rr), -np.sin(rr), 0], [np.sin(rr), np.cos(rr), 0], [0, 0, 1]])
    rx = np.array([[1, 0, 0], [0, np.cos(rp), -np.sin(rp)], [0, np.sin(rp), np.cos(rp)]])
    rym = np.array([[np.cos(ry), 0, np.sin(ry)], [0, 1, 0], [-np.sin(ry), 0, np.cos(ry)]])
    uv = project(POINTS, rotation_vector(rz @ rx @ rym), np.array([0.0, 0.0, 2.5]), K)
    if noise:
        uv = uv + np.random.default_rng(seed).normal(scale=noise, size=uv.shape)
    return {name: (float(uv[i, 0]), float(uv[i, 1])) for i, name in enumerate(RIGID_SIX)}


# --- picking points out of a mesh -------------------------------------------


def test_the_six_points_are_read_at_their_indices_and_scaled_to_pixels():
    mesh = np.zeros((478, 2))
    for i, (name, index) in enumerate(CRANIO_ORBITAL_INDICES.items()):
        mesh[index] = [0.1 * (i + 1), 0.2 * (i + 1)]  # normalised

    picked = cranio_orbital_from_mesh(mesh, 1080, 1440)
    assert picked is not None
    assert set(picked) == set(CRANIO_ORBITAL_INDICES)
    for i, name in enumerate(CRANIO_ORBITAL_INDICES):
        assert picked[name] == pytest.approx((0.1 * (i + 1) * 1080, 0.2 * (i + 1) * 1440))


def test_a_mesh_too_small_for_the_indices_returns_none():
    assert cranio_orbital_from_mesh(np.zeros((50, 2)), 1080, 1440) is None


def test_a_non_finite_mesh_point_returns_none():
    """A face mesh with a nan in it is not a face whose orientation should be
    solved."""
    mesh = np.zeros((478, 2))
    mesh[CRANIO_ORBITAL_INDICES["nasion"]] = [np.nan, 0.5]
    assert cranio_orbital_from_mesh(mesh, 1080, 1440) is None


def test_a_wrongly_shaped_mesh_is_an_error():
    with pytest.raises(ValueError):
        cranio_orbital_from_mesh(np.zeros(478), 1080, 1440)


def test_the_six_indices_are_distinct():
    """Two names on one index would silently collapse the template, giving the
    fit five points and a degenerate pair it cannot separate."""
    assert len(set(CRANIO_ORBITAL_INDICES.values())) == len(CRANIO_ORBITAL_INDICES)


def test_the_index_mapping_covers_exactly_the_solver_template():
    assert set(CRANIO_ORBITAL_INDICES) == set(RIGID_SIX)


# --- THE gate: an unverified mapping cannot pass as a pose ------------------


def test_every_scrambled_correspondence_is_rejected():
    """The test that makes the unverified index list safe to run.

    MediaPipe's canonical face geometry is not shipped with the Python package,
    so nothing in this repository can check that index 168 really is the nasion.
    A wrong index does not announce itself - six wrongly-matched points still
    produce *a* pose. What it does do is break the geometry, which the rigid fit
    cannot explain.

    All 719 non-identity permutations, measured: RMS at least 6.22 px, median
    15.2, max 19.4. Against a worst correct fit of 3.98 px at 3 px of landmark
    noise. No overlap.
    """
    base = observed(noise=1.3, seed=0)
    names = list(RIGID_SIX)
    accepted = []
    for perm in itertools.permutations(range(6)):
        if all(i == p for i, p in enumerate(perm)):
            continue
        swapped = {names[i]: base[names[perm[i]]] for i in range(6)}
        pose = head_pose_from_landmarks(swapped, LEVEL, K)
        if pose is not None:
            accepted.append(perm)
    assert accepted == [], f"{len(accepted)} scrambled mappings passed the gate"


def test_the_left_right_mirror_is_rejected_too():
    """Worth its own test because the intuitive guess is the opposite: the
    template is left-right symmetric, so a swap might seem to fit equally well.

    It does not. Mapping template-left onto observed-right is a REFLECTION, and
    a rigid rotation cannot produce one, so the fit cannot explain the points at
    all - measured 19.4 px. The determinant-+1 constraint is doing real work.
    """
    base = observed(noise=1.3, seed=0)
    mirrored = {
        "nasion": base["nasion"],
        "subnasale": base["subnasale"],
        "exocanthion_left": base["exocanthion_right"],
        "exocanthion_right": base["exocanthion_left"],
        "tragus_left": base["tragus_right"],
        "tragus_right": base["tragus_left"],
    }
    solved = solve_rigid_pose(mirrored, K)
    assert solved is not None
    assert solved[2] > MAX_RMS_REPROJECTION_PX
    assert head_pose_from_landmarks(mirrored, LEVEL, K) is None


@pytest.mark.parametrize("noise", [0.0, 1.0, 1.3, 2.0, 3.0])
def test_a_correct_mapping_is_never_rejected_at_realistic_noise(noise):
    """The other half of the gate's calibration: it must not throw away good
    frames. The worst correct fit at 3 px of landmark error is 3.98 px, well
    inside the 6 px threshold."""
    rejected = sum(
        head_pose_from_landmarks(observed(noise=noise, seed=seed), LEVEL, K) is None
        for seed in range(100)
    )
    assert rejected == 0


def test_the_threshold_sits_between_the_two_measured_populations():
    correct = [solve_rigid_pose(observed(noise=3.0, seed=s), K)[2] for s in range(100)]
    base = observed(noise=1.3, seed=0)
    names = list(RIGID_SIX)
    wrong = []
    for perm in itertools.permutations(range(6)):
        if all(i == p for i, p in enumerate(perm)):
            continue
        swapped = {names[i]: base[names[perm[i]]] for i in range(6)}
        solved = solve_rigid_pose(swapped, K)
        if solved:
            wrong.append(solved[2])
    assert max(correct) < MAX_RMS_REPROJECTION_PX < min(wrong)


def test_a_grossly_displaced_single_landmark_is_rejected():
    """One point put somewhere impossible - a tracking failure on one landmark -
    rather than a systematic mis-mapping."""
    broken = dict(observed(noise=1.0, seed=2))
    broken["tragus_left"] = (broken["tragus_left"][0] + 120.0, broken["tragus_left"][1])
    assert head_pose_from_landmarks(broken, LEVEL, K) is None


# --- expected absences are not errors ---------------------------------------


@pytest.mark.parametrize("view", ["posterior", "left_lateral", "right_lateral"])
def test_a_non_face_view_yields_no_frames_rather_than_an_error(view, tmp_path):
    """A posterior capture has no face and a lateral one shows at most half.
    The ear-line fallback covers those views."""
    assert load_face_frames(tmp_path / "missing.mov", _sidecar(), view=view) == []
    assert view not in FACE_VIEWS


def test_a_missing_model_bundle_yields_no_frames_rather_than_an_error(tmp_path, monkeypatch):
    """`.models/` is gitignored and the bundle is fetched by a script, so a
    deployment without it is an expected state. The head pose is additive; its
    absence must never fail a clip whose body analysis succeeded."""
    monkeypatch.setenv("FACE_LANDMARKER_MODEL_PATH", str(tmp_path / "nope.task"))
    import importlib

    import app.config

    importlib.reload(app.config)
    try:
        assert not model_available()
        assert load_face_frames(tmp_path / "clip.mov", _sidecar(), view="anterior") == []
    finally:
        monkeypatch.delenv("FACE_LANDMARKER_MODEL_PATH", raising=False)
        importlib.reload(app.config)


def test_an_unreadable_clip_costs_the_head_pose_and_nothing_else(tmp_path, monkeypatch):
    """The broad except in `load_face_frames` is deliberate: this path runs a
    second ML model over the same file, and a codec quirk or a delegate failure
    must not take the posture metrics with it."""
    monkeypatch.setattr("app.clips.face_video.model_available", lambda *a, **k: True)
    not_a_video = tmp_path / "clip.mov"
    not_a_video.write_bytes(b"definitely not a video")
    assert load_face_frames(not_a_video, _sidecar(), view="anterior") == []


class _Sidecar:
    width = 1080
    height = 1440


def _sidecar() -> _Sidecar:
    return _Sidecar()
