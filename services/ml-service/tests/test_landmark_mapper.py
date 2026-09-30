from app.pose.landmark_mapper import CANONICAL_JOINT_NAMES, map_landmarks_to_frame
from app.pose.mediapipe_adapter import RawLandmark


def test_no_landmarks_marks_every_joint_occluded_with_null_position():
    frame = map_landmarks_to_frame([])
    assert len(frame) == len(CANONICAL_JOINT_NAMES) == 33
    assert all(lm["observationState"] == "occluded" for lm in frame)
    assert all(lm["position"] is None for lm in frame)


def test_high_visibility_landmark_is_observed_with_position():
    raw = [RawLandmark(x=0.1, y=0.2, z=0.3, visibility=0.95, presence=0.95)] + [
        RawLandmark(x=0, y=0, z=0, visibility=0.0, presence=0.0) for _ in range(32)
    ]
    frame = map_landmarks_to_frame(raw)
    assert frame[0]["observationState"] == "observed"
    assert frame[0]["position"] == [0.1, 0.2, 0.3]
    assert frame[1]["observationState"] == "occluded"
    assert frame[1]["position"] is None


def test_low_visibility_landmark_is_occluded_even_though_mediapipe_returned_a_position():
    # A coordinate below the visibility threshold must be discarded, not
    # reported as observed - this is the enforcement point for "never impute an
    # occluded joint as observed".
    raw = [RawLandmark(x=0.5, y=0.5, z=0.5, visibility=0.2, presence=0.2)]
    frame = map_landmarks_to_frame(raw)
    assert frame[0]["observationState"] == "occluded"
    assert frame[0]["position"] is None
