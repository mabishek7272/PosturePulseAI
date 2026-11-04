"""`static3d.*` end to end through POST /internal/clips/analyze.

A 3D torso scene is rendered consistently as video landmarks AND a depth track
(`static3d_scene.py`), so every assertion has a known right answer. This is the
test that exercises the join nothing had built: pose observations + depth frames
-> gravity-aligned torso frames -> metrics -> schema-valid, provenance-stamped
records.

The structural claims it pins, in order of how badly each would hurt if broken:

1. **Dormant unless asked for.** No `static3d.*` row exists unless the request
   lists the key, and the request lists it only if the battery does. The battery
   is the single switch while ADR-020 is `Proposed`.
2. **A depth failure suppresses `static3d.*` only.** The 2D results are the same
   field for field whether the depth track is perfect, corrupt or absent.
3. **Every requested key gets exactly one result**, an estimate or an unsupported
   with a reason - `analysis-job-runner.checkResults` rejects a missing one.
4. **Records validate against the metric-result schema.** A `module` outside the
   schema's enum made every depth record invalid; it was invisible until a record
   was actually built.
"""
from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest
from fastapi.testclient import TestClient

from app.api.clip_routes import get_observation_loader
from app.main import app
from app.metrics.depth_metrics import (
    AXIAL_TWIST_KEY,
    DEPTH_CALIBRATION_VERSION,
    DEPTH_MEASUREMENT_METHOD,
    DEPTH_METRIC_KEYS,
    DEPTH_METRICS_VERSION,
    SUBJECT_YAW_KEY,
)
from app.versioning import CALIBRATION_VERSION, METRICS_VERSION
from clip_helpers import ANTERIOR_KEYS, request_body
from depth_helpers import encode_depth_file, flat_depth_mm
import static3d_scene as scene

SCHEMAS_SRC = Path(__file__).resolve().parents[3] / "packages" / "schemas" / "src"
client = TestClient(app)


def _validator() -> jsonschema.Draft202012Validator:
    common = json.loads((SCHEMAS_SRC / "common.schema.json").read_text())
    qgf = json.loads((SCHEMAS_SRC / "quality-gate-flag.schema.json").read_text())
    schema = json.loads((SCHEMAS_SRC / "metric-result.schema.json").read_text())
    store = {common["$id"]: common, qgf["$id"]: qgf}
    resolver = jsonschema.validators.RefResolver(base_uri=schema["$id"], referrer=schema, store=store)
    return jsonschema.Draft202012Validator(schema, resolver=resolver, format_checker=jsonschema.FormatChecker())


@pytest.fixture
def clip(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIP_DIR", str(tmp_path))
    path = tmp_path / "clip-1.mov"
    path.write_bytes(b"not really a video")
    yield tmp_path, path
    app.dependency_overrides.clear()


def run(clip, *, keys=None, **scene_kwargs):
    tmp_path, clip_path = clip
    side, depth_path, observations = scene.build(tmp_path, **scene_kwargs)
    app.dependency_overrides[get_observation_loader] = lambda: (lambda path, s: observations)
    extra = {"depthPath": str(depth_path)} if depth_path is not None else {}
    # 6, as every step in the v0 battery has: the server rejects pitch past 2x it.
    response = client.post(
        "/internal/clips/analyze",
        json=request_body(
            str(clip_path), side=side, keys=keys if keys is not None else [*ANTERIOR_KEYS, *DEPTH_METRIC_KEYS],
            levelToleranceDegrees=6, **extra,
        ),
    )
    assert response.status_code == 200, response.text
    return response.json()


def row(body, key):
    matches = [r for r in body["results"] if r["metricKey"] == key]
    assert len(matches) == 1, f"{key}: {len(matches)} results"
    return matches[0]


def non_depth(body):
    """The 2D results, with the per-call ids removed so two runs compare equal."""
    return [
        {k: v for k, v in r.items() if k not in ("resultId",)} | {"provenance": {
            k: v for k, v in r["provenance"].items() if k != "producedAt"
        }}
        for r in body["results"]
        if r["metricKey"] not in DEPTH_METRIC_KEYS
    ]


# --- recovering a known scene -------------------------------------------------


def test_a_squarely_facing_subject_reads_zero_yaw_and_zero_twist(clip):
    body = run(clip, shoulder_yaw=0.0)
    assert row(body, SUBJECT_YAW_KEY)["estimate"]["value"] == pytest.approx(0.0, abs=0.5)
    assert row(body, AXIAL_TWIST_KEY)["estimate"]["value"] == pytest.approx(0.0, abs=0.5)


@pytest.mark.parametrize("yaw", [8.0, 15.0, 20.0])
def test_a_turned_subject_is_recovered(clip, yaw):
    """Built at `yaw`, measured through the real endpoint from rendered depth."""
    body = run(clip, shoulder_yaw=yaw)
    assert row(body, SUBJECT_YAW_KEY)["estimate"]["value"] == pytest.approx(yaw, abs=1.5)
    # The whole body turned together, so no twist.
    assert row(body, AXIAL_TWIST_KEY)["estimate"]["value"] == pytest.approx(0.0, abs=1.5)


def test_a_twisted_trunk_reads_the_full_twist_and_the_averaged_yaw(clip):
    """Shoulders at 12 over a pelvis at 0. The twist comes from the two CHORDS
    and recovers all 12; the torso-wide yaw is the average, about 7.8 - the
    distinction ADR-020 section 2 draws between the gate and the de-bias."""
    body = run(clip, shoulder_yaw=12.0, pelvis_yaw=0.0)
    assert row(body, AXIAL_TWIST_KEY)["estimate"]["value"] == pytest.approx(12.0, abs=1.5)
    assert row(body, SUBJECT_YAW_KEY)["estimate"]["value"] == pytest.approx(7.8, abs=1.5)


def test_a_pitched_camera_is_removed_by_the_gravity_frame(clip):
    """The same 15 degree subject seen by a camera pitched 10 degrees, which the
    2D path tolerates (its limit is 12). Reading it back in the gravity frame is
    the point of the whole alignment step."""
    level = row(run(clip, shoulder_yaw=15.0), SUBJECT_YAW_KEY)["estimate"]["value"]
    pitched = row(run(clip, shoulder_yaw=15.0, pitch=10.0), SUBJECT_YAW_KEY)["estimate"]["value"]
    assert pitched == pytest.approx(level, abs=2.0)
    assert pitched == pytest.approx(15.0, abs=2.5)


def test_pitch_widens_the_reported_uncertainty_as_it_should(clip):
    """Measured: tilt roughly doubles the true yaw sigma, because depth error
    rotates into the horizontal plane. The rotated covariance carries that; the
    un-rotated one reported a fixed value regardless."""
    level = row(run(clip, shoulder_yaw=15.0), SUBJECT_YAW_KEY)["estimate"]["uncertainty"]
    pitched = row(run(clip, shoulder_yaw=15.0, pitch=10.0), SUBJECT_YAW_KEY)["estimate"]["uncertainty"]
    assert pitched > 1.03 * level


def test_the_twist_is_reported_with_an_uncertainty_wider_than_a_five_degree_effect(clip):
    """Why it ships as `proxy`: its own sigma exceeds the effect size anyone is
    likely to care about."""
    assert row(run(clip, shoulder_yaw=0.0), AXIAL_TWIST_KEY)["estimate"]["uncertainty"] > 4.0


def test_realistic_correlated_depth_noise_costs_frames_not_correctness(clip):
    """With the correlated-noise field, the consensus gate rejects many frames
    (patches that straddle noise and the yaw gradient) and the survivors still
    give the right answer. The cost is reported, not hidden."""
    body = run(clip, shoulder_yaw=15.0, noise_seed=3)
    estimate = row(body, SUBJECT_YAW_KEY)["estimate"]
    assert estimate["framesUsed"] < 30  # frames were lost
    assert estimate["value"] == pytest.approx(15.0, abs=3 * estimate["uncertainty"])
    torso = body["depth"]["torsoFrames"]
    assert torso["considered"] == 30 and torso["kept"] == estimate["framesUsed"]
    assert sum(torso["dropped"].values()) == torso["considered"] - torso["kept"]
    assert torso["landmarkRejections"], "which landmark was the weak link should be visible"


# --- records ---------------------------------------------------------------


def test_depth_records_are_valid_metric_results(clip):
    """The regression for the `module` enum: `module="static3d"` is not in the
    schema, so every depth record failed validation at the boundary. It stayed
    hidden because no record had ever been built."""
    body = run(clip, shoulder_yaw=15.0)
    validator = _validator()
    for key in DEPTH_METRIC_KEYS:
        record = row(body, key)
        validator.validate(record)
        assert record["module"] == "static"


def test_depth_records_carry_their_own_provenance(clip):
    record = row(run(clip, shoulder_yaw=15.0), SUBJECT_YAW_KEY)
    prov = record["provenance"]
    assert prov["measurementMethod"] == DEPTH_MEASUREMENT_METHOD == "mediapipe_2_5d_depth"
    assert prov["metricsVersion"] == DEPTH_METRICS_VERSION
    # Real, unlike the 2D path's "none/v0": these ARE computed from true intrinsics.
    assert prov["calibrationVersion"] == DEPTH_CALIBRATION_VERSION
    assert prov["calibrationVersion"] != CALIBRATION_VERSION
    assert "arkit-depth" in prov["modelVersion"]
    assert record["tier"] == "proxy"


def test_2d_records_keep_their_own_provenance_untouched(clip):
    body = run(clip, shoulder_yaw=15.0)
    for record in body["results"]:
        if record["metricKey"] in DEPTH_METRIC_KEYS:
            continue
        assert record["provenance"]["measurementMethod"] == "mediapipe_2d_image_plane"
        assert record["provenance"]["calibrationVersion"] == CALIBRATION_VERSION
        assert record["provenance"]["metricsVersion"] == METRICS_VERSION


def test_unsupported_depth_records_are_valid_too(clip):
    body = run(clip, with_depth=False)
    validator = _validator()
    for key in DEPTH_METRIC_KEYS:
        validator.validate(row(body, key))


# --- dormant unless asked for -------------------------------------------------


def test_no_static3d_row_exists_unless_the_key_is_requested(clip):
    """The battery is the single switch. A clip with a perfect depth track and
    full intrinsics still produces nothing depth-derived if no key asks."""
    body = run(clip, keys=list(ANTERIOR_KEYS), shoulder_yaw=15.0)
    assert not any(r["metricKey"].startswith("static3d.") for r in body["results"])
    assert body["depth"]["state"] == "decoded"  # the health block is separate


def test_requesting_only_depth_keys_works(clip):
    """`keys_2d` is empty, which the 2D analysis must tolerate."""
    body = run(clip, keys=list(DEPTH_METRIC_KEYS), shoulder_yaw=15.0)
    assert sorted(r["metricKey"] for r in body["results"]) == sorted(DEPTH_METRIC_KEYS)


def test_one_depth_key_alone_yields_exactly_that_one(clip):
    body = run(clip, keys=[*ANTERIOR_KEYS, SUBJECT_YAW_KEY], shoulder_yaw=15.0)
    assert [r["metricKey"] for r in body["results"] if r["metricKey"].startswith("static3d.")] == [SUBJECT_YAW_KEY]


def test_an_unknown_key_is_still_rejected(clip):
    """Splitting the depth keys out must not have loosened the 2D validation."""
    tmp_path, clip_path = clip
    side, depth_path, observations = scene.build(tmp_path)
    app.dependency_overrides[get_observation_loader] = lambda: (lambda p, s: observations)
    response = client.post(
        "/internal/clips/analyze",
        json=request_body(str(clip_path), side=side, keys=["static3d.made_up", *ANTERIOR_KEYS], depthPath=str(depth_path)),
    )
    assert response.status_code == 422


def test_every_requested_key_gets_exactly_one_result(clip):
    """`checkResults` rejects a missing result, so a key that silently vanished
    would fail the whole job."""
    for kwargs in (
        {"shoulder_yaw": 15.0},
        {"with_depth": False},
        {"with_intrinsics": False},
        {"shoulder_yaw": 15.0, "noise_seed": 3},
    ):
        body = run(clip, **kwargs)
        keys = [r["metricKey"] for r in body["results"]]
        assert sorted(keys) == sorted([*ANTERIOR_KEYS_EXPANDED(body), *DEPTH_METRIC_KEYS]), kwargs
        for r in body["results"]:
            assert ("estimate" in r) != ("unsupported" in r), "a value or reasons, never both or neither"


def ANTERIOR_KEYS_EXPANDED(body):
    """The 2D keys as they appear in the response (the knee key is per side)."""
    return [r["metricKey"] for r in body["results"] if r["metricKey"] not in DEPTH_METRIC_KEYS]


# --- a depth failure suppresses static3d only -------------------------------


def test_a_missing_depth_track_is_depth_unavailable(clip):
    body = run(clip, with_depth=False)
    for key in DEPTH_METRIC_KEYS:
        assert row(body, key)["unsupported"]["reasons"] == ["depth_unavailable"]


def test_missing_intrinsics_is_depth_unavailable(clip):
    """A guessed fx is a guessed metric scale, so with no camera there is nothing
    to compute - and the reason says the capability was absent."""
    body = run(clip, with_intrinsics=False)
    for key in DEPTH_METRIC_KEYS:
        assert row(body, key)["unsupported"]["reasons"] == ["depth_unavailable"]


def test_2d_results_are_identical_with_perfect_corrupt_and_absent_depth(clip):
    """The structural invariant: a depth failure can never degrade a 2D result.
    Compared field for field, not just 'still an estimate'."""
    tmp_path, _ = clip
    perfect = non_depth(run(clip, shoulder_yaw=15.0))

    absent = non_depth(run(clip, shoulder_yaw=15.0, with_depth=False))

    side, depth_path, observations = scene.build(tmp_path, shoulder_yaw=15.0)
    encode_depth_file(depth_path, [flat_depth_mm(1.0)])  # well-formed, wrong bytes
    app.dependency_overrides[get_observation_loader] = lambda: (lambda p, s: observations)
    corrupt_body = client.post(
        "/internal/clips/analyze",
        json=request_body(
            str(clip[1]), side=side, keys=[*ANTERIOR_KEYS, *DEPTH_METRIC_KEYS],
            levelToleranceDegrees=6, depthPath=str(depth_path),
        ),
    ).json()
    corrupt = non_depth(corrupt_body)

    assert perfect == absent == corrupt
    for key in DEPTH_METRIC_KEYS:
        assert row(corrupt_body, key)["unsupported"]["reasons"] == ["depth_unavailable"]


def test_a_failed_2d_quality_gate_carries_its_reasons_to_the_depth_rows(clip):
    """A depth value from a clip whose 2D quality failed is as compromised as the
    2D one. (`camera_not_level` is the one reason 3D could survive - a documented
    future relaxation, deliberately not built.)"""
    body = run(clip, shoulder_yaw=15.0, pitch=10.0, keys=[*ANTERIOR_KEYS, *DEPTH_METRIC_KEYS])
    # Inside the 12 degree limit the clip is fine...
    assert "estimate" in row(body, SUBJECT_YAW_KEY)

    tmp_path, clip_path = clip
    side, depth_path, observations = scene.build(tmp_path, shoulder_yaw=15.0, pitch=10.0)
    app.dependency_overrides[get_observation_loader] = lambda: (lambda p, s: observations)
    strict = client.post(
        "/internal/clips/analyze",
        json=request_body(
            str(clip_path), side=side, keys=[*ANTERIOR_KEYS, *DEPTH_METRIC_KEYS],
            levelToleranceDegrees=3, depthPath=str(depth_path),  # limit 6 < 10
        ),
    ).json()
    for key in DEPTH_METRIC_KEYS:
        assert row(strict, key)["unsupported"]["reasons"] == ["camera_not_level"]
    # ...and the 2D rows failed for the same reason.
    assert all(
        r["unsupported"]["reasons"] == ["camera_not_level"]
        for r in strict["results"]
        if r["metricKey"] in ANTERIOR_KEYS
    )
