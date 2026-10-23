"""Every static metric on synthetic landmarks whose answer (value and sign) is
obvious by construction. Poses are in true-vertical pixels; H = 1430 px."""
import math

import numpy as np
import pytest

from app.clips.analysis import UnknownMetricError, analyze_observations
from app.metrics.static_metrics import STATIC_METRICS, aggregate
from synthetic_pose import (
    BASE_H,
    HEIGHT,
    WIDTH,
    anterior_pose,
    lateral_pose,
    lateral_visibility,
    make_frames,
    posterior_pose,
    rolled_gravity,
    rotate_pose,
)

ANTERIOR_KEYS = [
    "static.head_lateral_tilt",
    "static.shoulder_line_tilt",
    "static.hip_line_tilt",
    "static.trunk_lateral_lean",
    "static.lateral_body_shift",
    "static.knee_frontal_alignment",
]
LATERAL_KEYS = [
    "static.plumb_offset_ear",
    "static.plumb_offset_shoulder",
    "static.plumb_offset_hip",
    "static.plumb_offset_knee",
    "static.head_shoulder_angle",
    "static.trunk_inclination",
    "static.knee_extension",
]


def _run(frames, view, keys):
    return analyze_observations(
        frames,
        view=view,
        width=WIDTH,
        height=HEIGHT,
        metric_keys=keys,
        min_fps=24.0,
        level_tolerance_degrees=3.0,
    )


def _value(frames, view, key, side=None):
    outcome = _run(frames, view, [key])
    matches = [m for m in outcome.metrics if m.metric_key == key and m.side == side]
    assert len(matches) == 1, outcome.metrics
    m = matches[0]
    assert m.reasons is None, m.reasons
    return m.value


def _shift(pose, names, dx=0.0, dy=0.0):
    out = dict(pose)
    for n in names:
        x, y = out[n]
        out[n] = (x + dx, y + dy)
    return out


def _lateral(near="left", facing=1, **moves):
    pose = lateral_pose(near, facing=facing)
    for part, (dx, dy) in moves.items():
        # The head moves as a unit: the nose stays in front of the ear.
        names = [f"{near}_{part}"] + (["nose"] if part == "ear" else [])
        pose = _shift(pose, names, dx, dy)
    return make_frames(pose, visibility=lateral_visibility(near))


def _deg(rad):
    return math.degrees(rad)


# ---- frontal line tilts: + = person's left side lower --------------------------------------


@pytest.mark.parametrize(
    "key,left,right,dx",
    [
        ("static.head_lateral_tilt", "left_ear", "right_ear", 90.0),
        ("static.shoulder_line_tilt", "left_shoulder", "right_shoulder", 320.0),
        ("static.hip_line_tilt", "left_hip", "right_hip", 200.0),
    ],
)
@pytest.mark.parametrize("view,pose_fn", [("anterior", anterior_pose), ("posterior", posterior_pose)])
def test_line_tilt_positive_when_left_side_lower(key, left, right, dx, view, pose_fn):
    frames = make_frames(_shift(pose_fn(), [left], dy=30.0))
    assert _value(frames, view, key) == pytest.approx(_deg(math.atan2(30.0, dx)), abs=0.01)
    frames = make_frames(_shift(pose_fn(), [right], dy=30.0))
    assert _value(frames, view, key) == pytest.approx(-_deg(math.atan2(30.0, dx)), abs=0.01)


def test_level_lines_are_zero():
    frames = make_frames(anterior_pose())
    for key in ANTERIOR_KEYS[:5]:
        assert _value(frames, "anterior", key) == pytest.approx(0.0, abs=0.01)


# ---- trunk lateral lean / lateral body shift: + = toward the person's left -----------------


def test_trunk_lateral_lean_anterior_toward_person_left_is_positive():
    # Anterior: the person's left is image right (+x).
    frames = make_frames(_shift(anterior_pose(), ["left_shoulder", "right_shoulder"], dx=50.0))
    assert _value(frames, "anterior", "static.trunk_lateral_lean") == pytest.approx(
        _deg(math.atan2(50.0, 500.0)), abs=0.01
    )


def test_trunk_lateral_lean_posterior_sign_flips():
    # Posterior: image right is the person's right -> leaning to image right is negative.
    frames = make_frames(_shift(posterior_pose(), ["left_shoulder", "right_shoulder"], dx=50.0))
    assert _value(frames, "posterior", "static.trunk_lateral_lean") == pytest.approx(
        -_deg(math.atan2(50.0, 500.0)), abs=0.01
    )


def test_lateral_body_shift_is_percent_of_body_height():
    frames = make_frames(_shift(anterior_pose(), ["left_shoulder", "right_shoulder"], dx=50.0))
    assert _value(frames, "anterior", "static.lateral_body_shift") == pytest.approx(50.0 / BASE_H * 100, abs=0.01)
    frames = make_frames(_shift(anterior_pose(), ["left_shoulder", "right_shoulder"], dx=-50.0))
    assert _value(frames, "anterior", "static.lateral_body_shift") == pytest.approx(-50.0 / BASE_H * 100, abs=0.01)


# ---- knee frontal alignment: + = knee toward the midline -----------------------------------


def _straight_legs(pose):
    out = dict(pose)
    for side in ("left", "right"):
        hx = out[f"{side}_hip"][0]
        for part in ("knee", "ankle", "heel"):
            out[f"{side}_{part}"] = (hx, out[f"{side}_{part}"][1])
    return out


def test_knee_frontal_alignment_two_results_zero_when_straight():
    frames = make_frames(_straight_legs(anterior_pose()))
    outcome = _run(frames, "anterior", ["static.knee_frontal_alignment"])
    assert [(m.metric_key, m.side) for m in outcome.metrics] == [
        ("static.knee_frontal_alignment", "left"),
        ("static.knee_frontal_alignment", "right"),
    ]
    assert all(m.value == pytest.approx(0.0, abs=0.01) for m in outcome.metrics)
    assert all(m.tier == "proxy" for m in outcome.metrics)


def test_knee_toward_midline_is_positive_and_away_negative():
    d = 35.0  # knee 35 px off a vertical 350+350 px leg
    expected = 2 * _deg(math.atan2(d, 350.0))
    pose = _straight_legs(anterior_pose())
    # Anterior: midline is at smaller x for the left leg (image right side).
    pose = _shift(pose, ["left_knee"], dx=-d)  # left knee toward midline
    pose = _shift(pose, ["right_knee"], dx=-d)  # right knee (image left) away from midline
    frames = make_frames(pose)
    assert _value(frames, "anterior", "static.knee_frontal_alignment", "left") == pytest.approx(expected, abs=0.01)
    assert _value(frames, "anterior", "static.knee_frontal_alignment", "right") == pytest.approx(-expected, abs=0.01)


# ---- lateral: plumb offsets, + = anterior of the ankle --------------------------------------


@pytest.mark.parametrize("near,facing,view", [("left", 1, "left_lateral"), ("right", -1, "right_lateral")])
@pytest.mark.parametrize("part", ["ear", "shoulder", "hip", "knee"])
def test_plumb_offset_forward_is_positive_for_either_facing(near, facing, view, part):
    frames = _lateral(near, facing, **{part: (40.0 * facing, 0.0)})
    key = f"static.plumb_offset_{part}"
    assert _value(frames, view, key, near) == pytest.approx(40.0 / BASE_H * 100, abs=0.01)
    frames = _lateral(near, facing, **{part: (-40.0 * facing, 0.0)})
    assert _value(frames, view, key, near) == pytest.approx(-40.0 / BASE_H * 100, abs=0.01)


def test_plumb_offsets_zero_when_stacked():
    frames = _lateral("left", 1)
    for key in LATERAL_KEYS[:4]:
        assert _value(frames, "left_lateral", key, "left") == pytest.approx(0.0, abs=0.01)


# ---- head-shoulder angle: 90 = ear straight above the shoulder ------------------------------


@pytest.mark.parametrize("near,facing,view", [("left", 1, "left_lateral"), ("right", -1, "right_lateral")])
def test_head_shoulder_angle(near, facing, view):
    assert _value(_lateral(near, facing), view, "static.head_shoulder_angle", near) == pytest.approx(90.0, abs=0.01)
    # Ear 190 px forward of and 190 px above the shoulder -> 45 degrees.
    frames = _lateral(near, facing, ear=(190.0 * facing, 0.0))
    assert _value(frames, view, "static.head_shoulder_angle", near) == pytest.approx(45.0, abs=0.01)


# ---- trunk inclination: + = forward ----------------------------------------------------------


@pytest.mark.parametrize("near,facing,view", [("left", 1, "left_lateral"), ("right", -1, "right_lateral")])
def test_trunk_inclination_forward_is_positive(near, facing, view):
    frames = _lateral(near, facing, shoulder=(50.0 * facing, 0.0))
    assert _value(frames, view, "static.trunk_inclination", near) == pytest.approx(
        _deg(math.atan2(50.0, 500.0)), abs=0.01
    )
    frames = _lateral(near, facing, shoulder=(-50.0 * facing, 0.0))
    assert _value(frames, view, "static.trunk_inclination", near) == pytest.approx(
        -_deg(math.atan2(50.0, 500.0)), abs=0.01
    )


# ---- knee extension: + = knee behind the hip-ankle line -------------------------------------


@pytest.mark.parametrize("near,facing,view", [("left", 1, "left_lateral"), ("right", -1, "right_lateral")])
def test_knee_extension_sign(near, facing, view):
    expected = 2 * _deg(math.atan2(35.0, 350.0))
    frames = _lateral(near, facing, knee=(-35.0 * facing, 0.0))  # knee posterior
    assert _value(frames, view, "static.knee_extension", near) == pytest.approx(expected, abs=0.01)
    frames = _lateral(near, facing, knee=(35.0 * facing, 0.0))  # knee anterior (bent)
    assert _value(frames, view, "static.knee_extension", near) == pytest.approx(-expected, abs=0.01)
    assert _value(_lateral(near, facing), view, "static.knee_extension", near) == pytest.approx(0.0, abs=0.01)


# ---- roll correction end to end -------------------------------------------------------------


def test_rolled_camera_gives_the_same_corrected_shoulder_tilt():
    pose = _shift(anterior_pose(), ["left_shoulder"], dy=20.0)
    level = _value(make_frames(pose), "anterior", "static.shoulder_line_tilt")
    rolled_frames = make_frames(rotate_pose(pose, 5.0), gravity=rolled_gravity(5.0))
    rolled = _value(rolled_frames, "anterior", "static.shoulder_line_tilt")
    assert rolled == pytest.approx(level, abs=0.01)
    # Without the matching gravity the 5 degrees would show up in the value.
    uncorrected = _value(make_frames(rotate_pose(pose, 5.0)), "anterior", "static.shoulder_line_tilt")
    assert abs(uncorrected - level) == pytest.approx(5.0, abs=0.01)


# ---- uncertainty model --------------------------------------------------------------------


def test_uncertainty_of_a_still_pose_is_the_landmark_model():
    # Visibility 0.9 everywhere: sigma_p = 0.01 * H / 0.9 per landmark; ears 90 px apart.
    frames = make_frames(anterior_pose())
    m = _run(frames, "anterior", ["static.head_lateral_tilt"]).metrics[0]
    sigma_p = 0.01 * BASE_H / 0.9
    expected = _deg(math.sqrt(2) * sigma_p / 90.0)
    assert m.uncertainty == pytest.approx(expected, abs=0.011)
    assert m.uncertainty >= expected  # rounded up, never down
    assert m.frames_used == 30


def test_low_visibility_floor_and_percent_uncertainty():
    frames = make_frames(anterior_pose())
    m = _run(frames, "anterior", ["static.lateral_body_shift"]).metrics[0]
    sigma_p = 0.01 * BASE_H / 0.9
    # midpoints: sigma_p / sqrt(2) each; difference of two midpoints -> sigma_p.
    assert m.uncertainty == pytest.approx(sigma_p / BASE_H * 100, abs=0.011)


def test_aggregate_combines_model_and_spread():
    values = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    sigmas = np.array([0.5] * 5)
    value, u = aggregate(values, sigmas)
    mad = 1.0
    assert value == 3.0
    assert u == pytest.approx(math.sqrt(0.5**2 + (1.4826 * mad) ** 2))


# ---- outcome shape ----------------------------------------------------------------------------


def test_every_requested_key_yields_exactly_one_outcome_per_side():
    out = _run(make_frames(anterior_pose()), "anterior", ANTERIOR_KEYS)
    keys = [(m.metric_key, m.side) for m in out.metrics]
    assert keys == [(k, None) for k in ANTERIOR_KEYS[:5]] + [
        ("static.knee_frontal_alignment", "left"),
        ("static.knee_frontal_alignment", "right"),
    ]
    for m in out.metrics:
        assert m.value is not None and m.uncertainty is not None and m.reasons is None
        assert m.sign_convention


def test_lateral_outcomes_carry_the_near_side():
    out = _run(_lateral("right", -1), "right_lateral", LATERAL_KEYS)
    assert [(m.metric_key, m.side) for m in out.metrics] == [(k, "right") for k in LATERAL_KEYS]


def test_metric_from_another_view_is_unsupported_wrong_view():
    out = _run(make_frames(anterior_pose()), "anterior", ["static.trunk_inclination"])
    (m,) = out.metrics
    assert m.value is None
    assert m.reasons == ["wrong_view"]


def test_lateral_body_shift_is_anterior_only():
    out = _run(make_frames(posterior_pose()), "posterior", ["static.lateral_body_shift"])
    assert out.metrics[0].reasons == ["wrong_view"]


def test_clip_failure_makes_every_metric_unsupported_with_the_clip_reasons():
    tilt = math.radians(8)
    frames = make_frames(anterior_pose(), gravity=(0.0, math.cos(tilt), math.sin(tilt)))
    out = _run(frames, "anterior", ANTERIOR_KEYS)
    assert len(out.metrics) == 7
    for m in out.metrics:
        assert m.value is None and m.uncertainty is None
        assert m.reasons == ["camera_not_level"]


def test_duplicate_keys_are_reported_once():
    out = _run(make_frames(anterior_pose()), "anterior", ["static.hip_line_tilt", "static.hip_line_tilt"])
    assert len(out.metrics) == 1


def test_unknown_metric_key_raises():
    with pytest.raises(UnknownMetricError):
        _run(make_frames(anterior_pose()), "anterior", ["static.not_a_metric"])


def test_registry_covers_the_spec_table():
    assert set(STATIC_METRICS) == set(ANTERIOR_KEYS) | set(LATERAL_KEYS)
    tiers = {k: d.tier for k, d in STATIC_METRICS.items()}
    assert tiers["static.shoulder_line_tilt"] == "proxy"
    assert tiers["static.hip_line_tilt"] == "proxy"
    assert tiers["static.knee_frontal_alignment"] == "proxy"
    assert tiers["static.head_shoulder_angle"] == "proxy"
    assert tiers["static.head_lateral_tilt"] == "estimate"
    assert STATIC_METRICS["static.lateral_body_shift"].unit == "percent_stature"
    assert STATIC_METRICS["static.plumb_offset_ear"].unit == "percent_stature"
    for d in STATIC_METRICS.values():
        if d.unit == "percent_stature":
            assert "nose" in d.description and "heel" in d.description


def test_lateral_clip_where_the_facing_direction_cannot_be_told_is_unsupported():
    pose = lateral_pose("left", facing=1)
    pose["nose"] = (pose["left_ear"][0], pose["nose"][1])  # nose directly over the ear
    out = _run(make_frames(pose, visibility=lateral_visibility("left")), "left_lateral", ["static.plumb_offset_ear"])
    assert out.metrics[0].value is None
    assert out.metrics[0].reasons == ["wrong_view"]


def test_frame_quality_summary_counts_the_hold_frames():
    out = _run(make_frames(anterior_pose()), "anterior", ["static.hip_line_tilt"])
    assert out.frame_quality == {"usable": 30, "total": 30, "reasons": []}
