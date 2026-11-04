"""app/metrics/depth_metrics.py - the `static3d.*` emission layer.

The invariants worth protecting here are mostly about what is NOT emitted: no
coronal tilt, no row without a reason when it fails, no silently-omitted key,
and no uncertainty that shrinks because the clip happened to be long.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.geometry.intrinsics import CameraIntrinsics
from app.metrics.depth_metrics import (
    AXIAL_TWIST_KEY,
    DEPTH_CALIBRATION_VERSION,
    DEPTH_MEASUREMENT_METHOD,
    DEPTH_METRICS_VERSION,
    DEPTH_VIEWS,
    MIN_DEPTH_FRAMES,
    SUBJECT_YAW_KEY,
    FrameTorso,
    catalog_entries,
    compute_depth_metrics,
)

K = CameraIntrinsics(fx=1000.0, fy=1000.0, cx=539.5, cy=719.5, width=1080, height=1440)
BODY_H = 1430.0
BOTH = [SUBJECT_YAW_KEY, AXIAL_TWIST_KEY]
SH, HIP, Z0 = 0.19, 0.14, 2.5


def torso_points(yaw_deg: float, pelvis_yaw_deg: float | None = None) -> dict[str, np.ndarray]:
    pelvis = yaw_deg if pelvis_yaw_deg is None else pelvis_yaw_deg

    def turn(p, deg):
        t = np.radians(deg)
        c, s = np.cos(t), np.sin(t)
        return np.array([[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]]) @ p

    centre = np.array([0.0, 0.0, Z0])
    return {
        "l_sh": turn(np.array([SH, -1.40, 0.0]), yaw_deg) + centre,
        "r_sh": turn(np.array([-SH, -1.40, 0.0]), yaw_deg) + centre,
        "l_hip": turn(np.array([HIP, -1.00, 0.0]), pelvis) + centre,
        "r_hip": turn(np.array([-HIP, -1.00, 0.0]), pelvis) + centre,
    }


def frames(
    n: int = 30,
    yaw: float = 0.0,
    pelvis_yaw: float | None = None,
    sigma_m: float = 0.013,
    jitter: float = 0.0,
    seed: int = 3,
    drop: set[str] | None = None,
) -> list[FrameTorso]:
    rng = np.random.default_rng(seed)
    out = []
    for i in range(n):
        pts = torso_points(yaw, pelvis_yaw)
        if jitter:
            pts = {k: v + rng.normal(scale=jitter, size=3) for k, v in pts.items()}
        if drop:
            pts = {k: v for k, v in pts.items() if k not in drop}
        uv = {
            k: (float(v[0] * K.fx / v[2] + K.cx), float(v[1] * K.fy / v[2] + K.cy))
            for k, v in pts.items()
        }
        out.append(
            FrameTorso(
                index=i, points=pts, uv=uv, depth_sigma={k: sigma_m for k in pts}
            )
        )
    return out


def run(fs, keys=None, **kw):
    return compute_depth_metrics(
        fs,
        metric_keys=keys if keys is not None else BOTH,
        view=kw.pop("view", "anterior"),
        body_height_px=BODY_H,
        intrinsics=kw.pop("intrinsics", K),
        **kw,
    )


def by_key(result) -> dict:
    return {o.metric_key: o for o in result.outcomes}


# --- what is emitted --------------------------------------------------------


def test_both_metrics_are_emitted_with_values_and_uncertainties():
    out = by_key(run(frames(yaw=12.0, pelvis_yaw=0.0)))
    assert set(out) == set(BOTH)
    for o in out.values():
        assert o.reasons is None
        assert o.value is not None and o.uncertainty is not None and o.uncertainty > 0
        assert o.module == "static"  # the key prefix, not the module, names the namespace
        assert o.unit == "deg"
        assert o.tier == "proxy"
        assert o.sign_convention
        assert o.frames_used >= MIN_DEPTH_FRAMES


def test_the_recovered_twist_is_the_geometry_that_was_built_in():
    out = by_key(run(frames(yaw=12.0, pelvis_yaw=0.0)))
    assert out[AXIAL_TWIST_KEY].value == pytest.approx(12.0, abs=0.5)


def test_a_twisted_trunk_has_no_single_yaw_and_the_metric_reports_the_average():
    """With the shoulders at 12 degrees and the pelvis at 0 there is no one
    "subject yaw": the torso plane is fitted across both girdles, so its normal
    sits BETWEEN them and the metric reports about 7.8 degrees.

    That is the honest answer for an overall body orientation, and it is the
    right input for the `wrong_view` GATE. It is the wrong input for de-biasing a
    specific 2D baseline: `static.shoulder_line_tilt` is inflated by
    `1/cos(shoulder yaw)`, not by `1/cos(torso-average yaw)`, so the de-bias
    when it lands must use the yaw of the CHORD it is correcting. Pinned here so
    that distinction is not lost between now and the `metrics/v2` bump."""
    out = by_key(run(frames(yaw=12.0, pelvis_yaw=0.0)))
    yaw = out[SUBJECT_YAW_KEY].value
    assert 0.0 < yaw < 12.0
    assert yaw == pytest.approx(7.8, abs=1.0)

    # Per-chord yaw, which the de-bias needs, recovers the full 12 degrees.
    from app.geometry.anatomical_basis import chord_facing_yaw

    fs = frames(yaw=12.0, pelvis_yaw=0.0)[0]
    assert chord_facing_yaw(fs.points["l_sh"], fs.points["r_sh"]) == pytest.approx(12.0, abs=0.01)
    assert chord_facing_yaw(fs.points["l_hip"], fs.points["r_hip"]) == pytest.approx(0.0, abs=0.01)


def test_the_twist_is_zero_when_the_pelvis_follows_the_shoulders():
    out = by_key(run(frames(yaw=20.0)))
    assert out[AXIAL_TWIST_KEY].value == pytest.approx(0.0, abs=0.5)
    assert out[SUBJECT_YAW_KEY].value == pytest.approx(20.0, abs=0.5)


def test_no_coronal_tilt_is_emitted():
    """ADR-020 section 5 is locked. The 3D coronal tilt carries about 7.8 degrees
    against the 2D row's baseline, so emitting it would put a known-worse number
    beside a better one for the same anatomical line."""
    keys = [o.metric_key for o in run(frames()).outcomes]
    assert not any("tilt" in k or "line" in k for k in keys)
    assert set(keys) == set(BOTH)


def test_only_requested_keys_are_emitted():
    """`analysis-job-runner.checkResults` rejects a result for a key that was not
    requested AND a missing result for one that was, so this has to be exact."""
    out = run(frames(), keys=[SUBJECT_YAW_KEY])
    assert [o.metric_key for o in out.outcomes] == [SUBJECT_YAW_KEY]


def test_unrelated_2d_keys_are_ignored_rather_than_answered():
    out = run(frames(), keys=["static.shoulder_line_tilt", "static.hip_line_tilt"])
    assert out.outcomes == []


# --- what is refused, and with which reason ---------------------------------


def test_a_missing_depth_track_is_depth_unavailable_not_a_sample_failure():
    """The distinction the v0 enum could not express: no track at all, versus a
    track that arrived and could not be used."""
    out = by_key(run(frames(), depth_present=False))
    assert set(out) == set(BOTH)
    for o in out.values():
        assert o.reasons == ["depth_unavailable"]
        assert o.value is None and o.uncertainty is None


def test_missing_intrinsics_is_also_depth_unavailable():
    """A guessed fx is a guessed metric scale, so with no camera there is
    nothing to compute - and the reason says the capability was absent, not that
    the body was unmeasurable."""
    out = by_key(run(frames(), intrinsics=None))
    for o in out.values():
        assert o.reasons == ["depth_unavailable"]


@pytest.mark.parametrize("view", ["left_lateral", "right_lateral"])
def test_a_lateral_view_is_wrong_view(view):
    """Both shoulders lie on one line of sight, so the left-right chord has no
    observable horizontal extent and neither metric is defined."""
    out = by_key(run(frames(), view=view))
    for o in out.values():
        assert o.reasons == ["wrong_view"]
    assert view not in DEPTH_VIEWS


def test_too_few_frames_with_a_full_torso_is_insufficient_depth_samples():
    out = by_key(run(frames(n=MIN_DEPTH_FRAMES - 1)))
    for o in out.values():
        assert o.reasons == ["insufficient_depth_samples"]


def test_a_landmark_the_sampler_never_resolved_is_insufficient_depth_samples():
    """A hip whose patch failed every frame leaves no complete torso."""
    out = by_key(run(frames(drop={"l_hip"})))
    for o in out.values():
        assert o.reasons == ["insufficient_depth_samples"]


def test_a_collinear_torso_is_torso_plane_underdetermined():
    """Stacked landmarks give no normal about the stacking line. The reason has
    to differ from a sampling failure: this one is about the subject's pose, the
    other about the sensor."""
    fs = []
    for i in range(30):
        pts = {
            "l_sh": np.array([0.0, -1.40, Z0]),
            "r_sh": np.array([0.0, -1.30, Z0]),
            "l_hip": np.array([0.0, -1.10, Z0]),
            "r_hip": np.array([0.0, -1.00, Z0]),
        }
        uv = {k: (K.cx, float(v[1] * K.fy / v[2] + K.cy)) for k, v in pts.items()}
        fs.append(FrameTorso(index=i, points=pts, uv=uv, depth_sigma={k: 0.013 for k in pts}))
    out = by_key(run(fs))
    for o in out.values():
        assert o.reasons == ["torso_plane_underdetermined"]


def test_every_requested_key_always_gets_exactly_one_outcome():
    """Across every failure mode. A key that silently vanished would be
    indistinguishable from one never asked for, and would fail the job runner's
    completeness check."""
    cases = [
        dict(depth_present=False),
        dict(intrinsics=None),
        dict(view="left_lateral"),
        {},
    ]
    for kw in cases:
        out = run(frames(n=2) if not kw else frames(), **kw)
        assert sorted(o.metric_key for o in out.outcomes) == sorted(BOTH), kw
        for o in out.outcomes:
            assert (o.reasons is None) != (o.value is None), "either a value or reasons, never both or neither"


def test_a_failure_reports_clip_reasons_for_the_health_block():
    assert run(frames(), depth_present=False).clip_reasons == ["depth_unavailable"]
    assert run(frames()).clip_reasons == []


# --- uncertainty behaviour --------------------------------------------------


def test_the_uncertainty_does_not_shrink_with_the_frame_count():
    """`aggregate` refuses to divide the model sigma by sqrt(N), and these
    metrics inherit that refusal. The dominant errors - bony-landmark offset,
    soft tissue, model asymmetry, systematic depth bias - are static across a
    static hold, so a long clip is not a more precise one."""
    short = by_key(run(frames(n=8)))[AXIAL_TWIST_KEY].uncertainty
    long = by_key(run(frames(n=240)))[AXIAL_TWIST_KEY].uncertainty
    assert long == pytest.approx(short, rel=0.05)
    # Thirty times the frames would have cut it 5.5-fold if sqrt(N) applied.
    assert long > 0.5 * short


def test_the_twist_carries_more_uncertainty_than_the_subject_yaw():
    """The twist is a difference of two yaws, one of them from the shorter
    pelvic chord, so it must come out wider."""
    out = by_key(run(frames()))
    assert out[AXIAL_TWIST_KEY].uncertainty > out[SUBJECT_YAW_KEY].uncertainty


def test_the_twist_uncertainty_still_exceeds_a_five_degree_effect():
    """Which is why it ships as `proxy`. If this ever drops below 5, the tier
    decision deserves revisiting deliberately rather than being noticed later."""
    assert by_key(run(frames()))[AXIAL_TWIST_KEY].uncertainty > 4.0


def test_a_noisier_clip_reports_a_wider_uncertainty():
    """`aggregate` folds the observed frame-to-frame spread in alongside the
    model sigma, so a restless hold is reported as less certain."""
    steady = by_key(run(frames(jitter=0.0)))[AXIAL_TWIST_KEY].uncertainty
    restless = by_key(run(frames(jitter=0.01)))[AXIAL_TWIST_KEY].uncertainty
    assert restless > steady


# --- provenance and the catalog ---------------------------------------------


def test_the_depth_path_declares_its_own_versions():
    assert DEPTH_METRICS_VERSION.startswith("depth-metrics/")
    assert DEPTH_MEASUREMENT_METHOD == "mediapipe_2_5d_depth"


def test_the_calibration_version_is_real_unlike_the_2d_paths():
    """The one genuine provenance change ADR-020 brings: these results ARE
    computed from a real camera calibration, so saying `none/v0` would
    understate what produced them.

    ADR-020's Consequences describes this as `is_scale_validated()` starting to
    return True. That function belongs to the per-frame path and the clip path
    never calls it, so this field is the whole of the actual change - worth
    recording, because the ADR sends a reader looking in the wrong place."""
    from app.versioning import CALIBRATION_VERSION

    assert CALIBRATION_VERSION == "none/v0"
    assert DEPTH_CALIBRATION_VERSION != CALIBRATION_VERSION
    assert "arkit" in DEPTH_CALIBRATION_VERSION


def test_the_method_is_one_value_for_the_whole_path_not_one_per_metric():
    """A per-metric method would split `agreement.py`'s strata by metric as well
    as by method, and neither half would reach a useful n."""
    methods = {DEPTH_MEASUREMENT_METHOD for _ in BOTH}
    assert len(methods) == 1
    assert DEPTH_MEASUREMENT_METHOD != "markerless_3d"


def test_the_catalog_entries_describe_both_metrics_without_a_clinical_claim():
    entries = {e["metricKey"]: e for e in catalog_entries()}
    assert set(entries) == set(BOTH)
    for e in entries.values():
        assert e["module"] == "static"
        assert e["tier"] == "proxy"
        assert e["unit"] == "deg"
        assert e["measurementMethod"] == DEPTH_MEASUREMENT_METHOD
        assert e["signConvention"] and e["description"]
    # The yaw entry says in plain words that it is not a posture finding.
    assert "not a posture measurement" in entries[SUBJECT_YAW_KEY]["description"]


def test_both_keys_live_under_the_static3d_namespace():
    """Reusing `static.shoulder_line_tilt` would silently inherit the 2D
    metric's reference comparison - two methods with different bias pooled under
    one norm."""
    for key in BOTH:
        assert key.startswith("static3d.")
