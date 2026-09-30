from app.pose.landmark_mapper import CANONICAL_JOINT_NAMES, map_landmarks_to_frame
from app.quality.quality_gate import evaluate_quality
from app.quality.unsupported_state import build_quality_gate_flag


def test_no_person_detected_is_unsupported_with_occlusion_reason():
    landmarks = map_landmarks_to_frame([])  # simulates "no person detected"
    assessment = evaluate_quality(landmarks)
    assert assessment["state"] == "unsupported"
    assert "occlusion" in assessment["reasons"]
    assert assessment["affectedOutputs"]  # must not be silently empty


def test_partial_detection_below_threshold_is_unsupported_with_insufficient_landmarks():
    from app.pose.mediapipe_adapter import RawLandmark

    # Only 5 of 33 joints observed - below MIN_OBSERVED_LANDMARKS_FOR_SUPPORTED (20).
    raw = [RawLandmark(x=0.1, y=0.1, z=0.1, visibility=0.9, presence=0.9) for _ in range(5)]
    landmarks = map_landmarks_to_frame(raw)
    assessment = evaluate_quality(landmarks)
    assert assessment["state"] == "unsupported"
    assert "insufficient_landmarks" in assessment["reasons"]


def test_sufficient_observed_landmarks_is_supported_with_empty_reasons():
    from app.pose.mediapipe_adapter import RawLandmark

    raw = [RawLandmark(x=0.1, y=0.1, z=0.1, visibility=0.9, presence=0.9) for _ in range(len(CANONICAL_JOINT_NAMES))]
    landmarks = map_landmarks_to_frame(raw)
    assessment = evaluate_quality(landmarks)
    assert assessment["state"] == "supported"
    assert assessment["reasons"] == []
    assert assessment["affectedOutputs"] == []


def test_build_quality_gate_flag_shape():
    flag = build_quality_gate_flag("s1", "f1", {"state": "unsupported", "reasons": ["occlusion"], "affectedOutputs": ["pose-landmark-frame"]})
    assert flag["sessionId"] == "s1"
    assert flag["frameId"] == "f1"
    assert flag["state"] == "unsupported"
    assert flag["reasons"] == ["occlusion"]
