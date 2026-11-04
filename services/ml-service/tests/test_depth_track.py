"""app/clips/depth_track.py - decoding the uploaded depth track and refusing
anything that disagrees with its description.

Every refusal here is a `DepthTrackError`, which the caller turns into a
transport-health block and never into a clip failure: the 2D result does not depend on
depth and must not be degraded by its absence (ADR-020, Consequences).
"""
from __future__ import annotations

import hashlib

import numpy as np
import pytest

from app.clips.depth_track import (
    DepthTrackError,
    depth_health,
    info_from_sidecar,
    nearest_frame,
    read_depth_track,
)
from app.geometry.intrinsics import CameraIntrinsics
from clip_helpers import sidecar
from depth_helpers import depth_sidecar_block, encode_depth_file, flat_depth_mm


def _track(tmp_path, frames_mm, **block_overrides):
    """A written depth file plus a sidecar that describes it."""
    path = encode_depth_file(tmp_path / "clip-1.depth", frames_mm)
    side = sidecar(n=30)
    side["depth"] = depth_sidecar_block(path, frames_mm, **block_overrides)
    return path, side


# --- the sidecar block ------------------------------------------------------


def test_no_depth_block_means_no_depth_not_an_error():
    assert info_from_sidecar(sidecar()) is None


def test_an_unknown_encoding_is_refused_rather_than_read_as_millimetres(tmp_path):
    _, side = _track(tmp_path, [flat_depth_mm(2.5)], encoding="float32_raw")
    with pytest.raises(DepthTrackError, match="encoding"):
        info_from_sidecar(side)


def test_an_unsupported_scale_is_refused_rather_than_assumed_to_be_one(tmp_path):
    """The schema allows a future fixed-point scale; this reader implements 1.
    Silently assuming 1 would rescale every distance by the real factor."""
    _, side = _track(tmp_path, [flat_depth_mm(2.5)], scaleMillimetres=0.25)
    with pytest.raises(DepthTrackError, match="scaleMillimetres"):
        info_from_sidecar(side)


def test_frame_count_must_match_the_frames_array(tmp_path):
    _, side = _track(tmp_path, [flat_depth_mm(2.5)], frameCount=450)
    with pytest.raises(DepthTrackError, match="frameCount"):
        info_from_sidecar(side)


# --- the file ---------------------------------------------------------------


def test_a_round_trip_recovers_the_metres_and_the_timestamps(tmp_path):
    frames_mm = [flat_depth_mm(2.5), flat_depth_mm(2.4), flat_depth_mm(2.6)]
    path, side = _track(tmp_path, frames_mm)
    frames = read_depth_track(path, info_from_sidecar(side))

    assert [f.index for f in frames] == [0, 1, 2]
    assert [round(f.t, 4) for f in frames] == [0.0, pytest.approx(1 / 15, abs=1e-4), pytest.approx(2 / 15, abs=1e-4)]
    assert frames[0].depth_m.shape == (192, 256)
    assert float(np.nanmedian(frames[0].depth_m)) == pytest.approx(2.5, abs=1e-3)
    assert float(np.nanmedian(frames[2].depth_m)) == pytest.approx(2.6, abs=1e-3)


def test_a_missing_return_becomes_nan_not_zero_metres(tmp_path):
    """0 in the file means "no return", which is not 0 m. If it survived as 0,
    every mean would be dragged toward the camera by the missing pixels - a
    fabricated measurement rather than an absent one (CLAUDE.md rule 3)."""
    frames_mm = [flat_depth_mm(2.5, valid=0.5)]
    path, side = _track(tmp_path, frames_mm)
    frame = read_depth_track(path, info_from_sidecar(side))[0]

    assert np.count_nonzero(np.isnan(frame.depth_m)) == frame.depth_m.size // 2
    assert frame.valid_fraction == pytest.approx(0.5)
    # The nan-aware statistic is unaffected by the missing half.
    assert float(np.nanmean(frame.depth_m)) == pytest.approx(2.5, abs=1e-3)
    # The naive statistic would have been halved - this is what nan prevents.
    assert float(np.mean(np.nan_to_num(frame.depth_m))) == pytest.approx(1.25, abs=1e-2)


def test_a_tampered_file_is_refused_before_it_is_decoded(tmp_path):
    frames_mm = [flat_depth_mm(2.5)]
    path, side = _track(tmp_path, frames_mm)
    info = info_from_sidecar(side)
    # Rewrite the file with different, perfectly well-formed content.
    encode_depth_file(path, [flat_depth_mm(1.2)])
    with pytest.raises(DepthTrackError, match="sha256"):
        read_depth_track(path, info)


def test_a_header_that_disagrees_with_the_sidecar_is_refused(tmp_path):
    frames_mm = [flat_depth_mm(2.5)]
    path = encode_depth_file(tmp_path / "c.depth", frames_mm, width=320)
    side = sidecar()
    side["depth"] = depth_sidecar_block(path, frames_mm)  # declares 256 wide
    with pytest.raises(DepthTrackError, match="320x192"):
        read_depth_track(path, info_from_sidecar(side))


def test_a_confidence_plane_the_sidecar_denies_is_refused(tmp_path):
    """Reading a file with a confidence plane as if it had none would leave the
    extra bytes misinterpreted, so the two descriptions must agree exactly."""
    frames_mm = [flat_depth_mm(2.5)]
    conf = [np.full((192, 256), 2, dtype=np.uint8)]
    path = encode_depth_file(tmp_path / "c.depth", frames_mm, confidence=conf)
    side = sidecar()
    side["depth"] = depth_sidecar_block(path, frames_mm, has_confidence=False)
    with pytest.raises(DepthTrackError, match="confidence"):
        read_depth_track(path, info_from_sidecar(side))


def test_the_confidence_plane_is_read_when_declared(tmp_path):
    frames_mm = [flat_depth_mm(2.5)]
    conf = [np.full((192, 256), 2, dtype=np.uint8)]
    path = encode_depth_file(tmp_path / "c.depth", frames_mm, confidence=conf)
    side = sidecar()
    side["depth"] = depth_sidecar_block(path, frames_mm, has_confidence=True)
    frame = read_depth_track(path, info_from_sidecar(side))[0]
    assert frame.confidence is not None
    assert frame.confidence.shape == (192, 256)
    assert int(frame.confidence.max()) == 2


def test_an_unknown_format_version_is_refused(tmp_path):
    frames_mm = [flat_depth_mm(2.5)]
    path = encode_depth_file(tmp_path / "c.depth", frames_mm, version=99)
    side = sidecar()
    side["depth"] = depth_sidecar_block(path, frames_mm)
    with pytest.raises(DepthTrackError, match="version"):
        read_depth_track(path, info_from_sidecar(side))


def test_a_file_that_is_not_a_depth_track_is_refused(tmp_path):
    path = tmp_path / "c.depth"
    path.write_bytes(b"this is a video, actually, and then some padding bytes")
    side = sidecar()
    side["depth"] = depth_sidecar_block(path, [flat_depth_mm(2.5)])
    with pytest.raises(DepthTrackError, match="magic"):
        read_depth_track(path, info_from_sidecar(side))


def test_a_truncated_payload_is_refused_rather_than_partly_decoded(tmp_path):
    frames_mm = [flat_depth_mm(2.5), flat_depth_mm(2.5)]
    path, side = _track(tmp_path, frames_mm)
    raw = path.read_bytes()
    path.write_bytes(raw[: len(raw) - 40])
    side["depth"]["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    with pytest.raises(DepthTrackError, match="ends inside"):
        read_depth_track(path, info_from_sidecar(side))


def test_more_frames_than_declared_is_refused(tmp_path):
    """Extra frames would be paired against the declared timestamps, so each one
    would be given a time it was not captured at."""
    frames_mm = [flat_depth_mm(2.5)] * 3
    path = encode_depth_file(tmp_path / "c.depth", frames_mm)
    side = sidecar()
    side["depth"] = depth_sidecar_block(path, frames_mm[:2])  # declares 2, file has 3
    side["depth"]["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    with pytest.raises(DepthTrackError, match="more than the declared"):
        read_depth_track(path, info_from_sidecar(side))


def test_fewer_frames_than_declared_is_refused(tmp_path):
    frames_mm = [flat_depth_mm(2.5)]
    path = encode_depth_file(tmp_path / "c.depth", frames_mm)
    side = sidecar()
    side["depth"] = depth_sidecar_block(path, [flat_depth_mm(2.5)] * 4)
    side["depth"]["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    with pytest.raises(DepthTrackError, match="1 frames"):
        read_depth_track(path, info_from_sidecar(side))


def test_a_missing_file_is_a_depth_error_not_a_crash(tmp_path):
    frames_mm = [flat_depth_mm(2.5)]
    path, side = _track(tmp_path, frames_mm)
    info = info_from_sidecar(side)
    path.unlink()
    with pytest.raises(DepthTrackError, match="not found"):
        read_depth_track(path, info)


# --- pairing and transport health -------------------------------------------


def test_nearest_frame_picks_the_closest_and_never_interpolates(tmp_path):
    frames_mm = [flat_depth_mm(2.5), flat_depth_mm(2.0), flat_depth_mm(1.5)]
    path, side = _track(tmp_path, frames_mm)
    frames = read_depth_track(path, info_from_sidecar(side))

    assert nearest_frame(frames, 0.0).index == 0
    assert nearest_frame(frames, 0.062).index == 1  # 1/15 = 0.0667
    assert nearest_frame(frames, 10.0).index == 2  # clamps to the last, no extrapolation
    assert nearest_frame([], 0.0) is None
    # The returned frame is one of the decoded frames, not a blend of two.
    assert nearest_frame(frames, 0.033) in frames


def test_health_report_transport_health_and_recover_a_known_hip_depth(tmp_path):
    """medianHipDepthMetres exists to be checked against the AR jig's own
    on-device distance reading: two independent measurements of one quantity, so
    a disagreement means the pixel mapping is wrong."""
    frames_mm = [flat_depth_mm(2.5, valid=0.8) for _ in range(5)]
    path, side = _track(tmp_path, frames_mm)
    frames = read_depth_track(path, info_from_sidecar(side))
    k = CameraIntrinsics(fx=1000.0, fy=1000.0, cx=539.5, cy=959.5, width=1080, height=1920)

    health = depth_health(frames, intrinsics=k, hip_pixels=(540.0, 960.0), video_size=(1080, 1920))

    assert health["frameCount"] == 5
    assert health["validSampleFraction"] == pytest.approx(0.8, abs=0.01)
    assert health["plausibleSampleFraction"] == pytest.approx(0.8, abs=0.01)
    assert health["intrinsicsPresent"] is True
    assert health["intrinsics"]["depth"]["cx"] == pytest.approx(127.5)
    assert health["medianHipDepthMetres"] == pytest.approx(2.5, abs=0.01)


def test_no_hip_landmark_means_no_hip_depth_rather_than_a_guessed_one(tmp_path):
    frames_mm = [flat_depth_mm(2.5)]
    path, side = _track(tmp_path, frames_mm)
    frames = read_depth_track(path, info_from_sidecar(side))
    health = depth_health(frames, intrinsics=None, hip_pixels=None, video_size=(1080, 1920))
    assert "medianHipDepthMetres" not in health
    assert health["intrinsicsPresent"] is False


def test_an_all_empty_patch_yields_no_hip_depth(tmp_path):
    """Every pixel a non-return: there is no measurement, so the field is absent
    rather than 0 or nan."""
    frames_mm = [flat_depth_mm(2.5, valid=0.0)]
    path, side = _track(tmp_path, frames_mm)
    frames = read_depth_track(path, info_from_sidecar(side))
    health = depth_health(frames, intrinsics=None, hip_pixels=(540.0, 960.0), video_size=(1080, 1920))
    assert "medianHipDepthMetres" not in health
    assert health["validSampleFraction"] == pytest.approx(0.0)


def test_a_hip_landmark_outside_the_frame_yields_no_hip_depth(tmp_path):
    frames_mm = [flat_depth_mm(2.5)]
    path, side = _track(tmp_path, frames_mm)
    frames = read_depth_track(path, info_from_sidecar(side))
    health = depth_health(frames, intrinsics=None, hip_pixels=(-500.0, 960.0), video_size=(1080, 1920))
    assert "medianHipDepthMetres" not in health


def test_implausible_depth_is_excluded_from_the_plausible_fraction(tmp_path):
    """A 20 m reading in a clinic room is a stray return or a decode error. It is
    counted out, never clamped into range."""
    frames_mm = [flat_depth_mm(20.0)]
    path, side = _track(tmp_path, frames_mm)
    frames = read_depth_track(path, info_from_sidecar(side))
    health = depth_health(frames, intrinsics=None, hip_pixels=(540.0, 960.0), video_size=(1080, 1920))
    assert health["validSampleFraction"] == pytest.approx(1.0)
    assert health["plausibleSampleFraction"] == pytest.approx(0.0)
    assert "medianHipDepthMetres" not in health
