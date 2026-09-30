"""Tests app/events/emitter.py's CalibratedJointFrame construction directly
with synthetic angle data - no real model/photo needed, same discipline as
test_kinematics.py.
"""
from app.events.emitter import build_calibrated_joint_frame

SYNTHETIC_ANGLES = [
    {"jointName": "leftKnee", "thetaRadians": 1.57, "uncertaintyRadians": 0.05, "sourceLandmarks": ["leftHip", "leftKnee", "leftAnkle"]},
]


def test_no_scale_calibration_ref_means_not_validated():
    frame = build_calibrated_joint_frame(
        session_id="s1", frame_id="f1:joints", source_frame_id="f1",
        scale_calibration_ref=None, angles=SYNTHETIC_ANGLES,
    )
    assert frame["scaleValidated"] is False
    assert frame["calibrationRef"] == "none/v0"


def test_real_scale_calibration_ref_means_validated():
    frame = build_calibrated_joint_frame(
        session_id="s1", frame_id="f1:joints", source_frame_id="f1",
        scale_calibration_ref="sc-123", angles=SYNTHETIC_ANGLES,
    )
    assert frame["scaleValidated"] is True
    assert frame["calibrationRef"] == "sc-123"
