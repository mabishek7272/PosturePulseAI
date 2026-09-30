import pytest

from app.geometry.scale_calibration import build_scale_calibration_record, compute_subject_specific_scale


def _observed(x, y, z, confidence=0.9):
    return {"position": [x, y, z], "confidence": confidence, "observationState": "observed"}


def _occluded():
    return {"position": None, "confidence": 0.0, "observationState": "occluded"}


def test_returns_none_when_ankle_or_nose_occluded():
    landmarks_by_name = {"leftAnkle": _occluded(), "nose": _observed(0, 0, 0)}
    assert compute_subject_specific_scale(landmarks_by_name, 1.7) is None


def test_returns_none_when_landmarks_missing_entirely():
    assert compute_subject_specific_scale({}, 1.7) is None


def test_computes_scale_factor_from_observed_landmarks():
    landmarks_by_name = {
        "leftAnkle": _observed(0, 0, 0),
        "nose": _observed(0, 1, 0),  # normalized span = 1.0
    }
    result = compute_subject_specific_scale(landmarks_by_name, 1.7)
    assert result is not None
    assert result["method"] == "subject_specific"
    # scale factor = (1.7 * 0.97) / 1.0
    assert result["scaleFactorMetersPerUnit"] == pytest.approx(1.7 * 0.97)
    assert result["uncertaintyMetersPerUnit"] > 0


def test_rejects_non_positive_height():
    with pytest.raises(ValueError):
        compute_subject_specific_scale({"leftAnkle": _observed(0, 0, 0), "nose": _observed(0, 1, 0)}, 0)


def test_build_scale_calibration_record_shape():
    computed = {
        "method": "subject_specific", "subjectHeightMeters": 1.7,
        "scaleFactorMetersPerUnit": 1.649, "uncertaintyMetersPerUnit": 0.05,
    }
    record = build_scale_calibration_record("s1", "f1", computed)
    assert record["sessionId"] == "s1"
    assert record["referenceSourceFrameId"] == "f1"
    assert record["method"] == "subject_specific"
    assert "scaleCalibrationId" in record and record["scaleCalibrationId"]
