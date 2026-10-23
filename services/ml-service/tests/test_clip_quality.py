import math

import numpy as np
import pytest

from app.quality.clip_quality import assess_clip
from synthetic_pose import (
    BASE_H,
    HEIGHT,
    INDEX,
    WIDTH,
    anterior_pose,
    empty_frames,
    lateral_pose,
    lateral_visibility,
    make_frames,
    posterior_pose,
)


def _assess(frames, view="anterior", min_fps=24.0, level_tolerance=3.0):
    return assess_clip(
        frames,
        view=view,
        width=WIDTH,
        height=HEIGHT,
        min_fps=min_fps,
        level_tolerance_degrees=level_tolerance,
    )


def test_good_anterior_clip_has_no_reasons_and_skips_first_second():
    q = _assess(make_frames(anterior_pose(), n=60))
    assert q.clip_reasons == []
    # 30 fps, frames at t >= 1.0 s are 30..59.
    assert q.usable_indices == list(range(30, 60))
    assert q.expected_frames == 30
    assert q.body_height == pytest.approx(BASE_H)
    assert q.measured_fps == pytest.approx(30.0)


def test_good_lateral_and_posterior_clips_pass():
    lat = _assess(
        make_frames(lateral_pose("left", facing=1), visibility=lateral_visibility("left")), view="left_lateral"
    )
    assert lat.clip_reasons == []
    assert lat.body_height == pytest.approx(BASE_H)
    post = _assess(make_frames(posterior_pose()), view="posterior")
    assert post.clip_reasons == []


def test_cropped_feet_is_out_of_frame():
    pose = {name: (x, y + 220.0) for name, (x, y) in anterior_pose().items()}  # heels at y=1950 > 1920
    vis = np.full(33, 0.9)
    for name in ("left_heel", "right_heel", "left_ankle", "right_ankle"):
        vis[INDEX[name]] = 0.2
    q = _assess(make_frames(pose, visibility=vis))
    assert "out_of_frame" in q.clip_reasons
    assert "insufficient_frames" in q.clip_reasons
    assert q.usable_indices == []


def test_landmark_inside_the_two_percent_margin_is_out_of_frame():
    pose = anterior_pose()
    pose["left_heel"] = (pose["left_heel"][0], HEIGHT * 0.985)  # visible, but inside the 2% margin
    q = _assess(make_frames(pose))
    assert "out_of_frame" in q.clip_reasons


def test_low_visibility_required_landmark_is_occlusion():
    vis = np.full(33, 0.9)
    vis[INDEX["right_knee"]] = 0.3
    q = _assess(make_frames(anterior_pose(), visibility=vis))
    assert "occlusion" in q.clip_reasons
    assert "out_of_frame" not in q.clip_reasons


def test_posterior_pose_in_anterior_step_is_wrong_view():
    q = _assess(make_frames(posterior_pose()), view="anterior")
    assert "wrong_view" in q.clip_reasons
    assert "insufficient_frames" in q.clip_reasons


def test_anterior_pose_in_posterior_step_is_wrong_view():
    q = _assess(make_frames(anterior_pose()), view="posterior")
    assert "wrong_view" in q.clip_reasons


def test_frontal_pose_in_lateral_step_is_wrong_view():
    q = _assess(make_frames(anterior_pose()), view="left_lateral")
    assert "wrong_view" in q.clip_reasons


def test_lateral_with_the_other_side_nearer_is_wrong_view():
    # Right side faces the camera (right side more visible) but the step asks for the left.
    frames = make_frames(lateral_pose("right", facing=-1), visibility=lateral_visibility("right"))
    q = _assess(frames, view="left_lateral")
    assert "wrong_view" in q.clip_reasons


def test_pitch_beyond_twice_the_tolerance_is_camera_not_level():
    tilt = math.radians(7)  # > 2 * 3 degrees
    q = _assess(make_frames(anterior_pose(), gravity=(0.0, math.cos(tilt), math.sin(tilt))))
    assert q.clip_reasons == ["camera_not_level"]
    assert q.pitch_degrees == pytest.approx(7.0)


def test_pitch_within_twice_the_tolerance_is_accepted():
    tilt = math.radians(5)
    q = _assess(make_frames(anterior_pose(), gravity=(0.0, math.cos(tilt), math.sin(tilt))))
    assert q.clip_reasons == []


def test_low_frame_rate_is_flagged():
    q = _assess(make_frames(anterior_pose(), n=60, fps=15.0))
    assert "insufficient_frame_rate" in q.clip_reasons
    assert q.measured_fps == pytest.approx(15.0)


def test_too_few_usable_frames_is_insufficient_frames():
    # 1.3 s at 30 fps -> only 9 frames after the 1 s skip (< floor of 10).
    q = _assess(make_frames(anterior_pose(), n=39))
    assert q.clip_reasons == ["insufficient_frames"]


def test_half_of_expected_frames_is_required():
    # 300 frames (10 s): 270 expected after the skip; only frames 30..149 usable.
    good, bad = anterior_pose(), posterior_pose()
    q = _assess(make_frames(lambda i: good if i < 150 else bad, n=300))
    assert len(q.usable_indices) == 120  # < 135 = 50% of 270
    assert "insufficient_frames" in q.clip_reasons
    assert "wrong_view" in q.clip_reasons


def test_bad_frames_inside_the_first_second_are_ignored():
    good, bad = anterior_pose(), posterior_pose()
    q = _assess(make_frames(lambda i: bad if i < 30 else good, n=60))
    assert q.clip_reasons == []
    assert len(q.usable_indices) == 30


def test_no_person_detected_is_insufficient_landmarks():
    q = _assess(empty_frames(n=60))
    assert q.clip_reasons == ["insufficient_landmarks", "insufficient_frames"]
    assert q.usable_indices == []
    assert q.body_height is None


def test_moving_subject_is_flagged():
    base = anterior_pose()

    def swaying(i):
        dx = 0.05 * BASE_H * math.sin(i / 3.0)
        return {name: (x + dx, y) for name, (x, y) in base.items()}

    q = _assess(make_frames(swaying, n=90))
    assert q.clip_reasons == ["subject_moving"]


def test_small_sway_is_not_moving():
    base = anterior_pose()

    def swaying(i):
        dx = 0.005 * BASE_H * math.sin(i / 3.0)
        return {name: (x + dx, y) for name, (x, y) in base.items()}

    assert _assess(make_frames(swaying, n=90)).clip_reasons == []


def test_frame_details_are_reported_per_frame():
    q = _assess(make_frames(anterior_pose(), n=40))
    assert len(q.frames) == 40
    assert q.frames[0].status == "skipped"
    assert q.frames[35].status == "usable"
    assert q.frames[35].reasons == []
