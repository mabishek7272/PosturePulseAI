from app.exposure.posture_bucket_classifier import classify_posture_bucket


def _hip_angle(joint_name, degrees):
    return {"jointName": joint_name, "thetaRadians": degrees * 3.141592653589793 / 180.0}


def test_unclassified_when_no_hip_angle_present():
    assert classify_posture_bucket([{"jointName": "leftKnee", "thetaRadians": 1.5}]) == "unclassified"


def test_neutral_when_upright():
    angles = [_hip_angle("leftHip", 175), _hip_angle("rightHip", 175)]
    assert classify_posture_bucket(angles) == "neutral"


def test_mild_flexion():
    angles = [_hip_angle("leftHip", 150), _hip_angle("rightHip", 150)]
    assert classify_posture_bucket(angles) == "forward_flexion_mild"


def test_moderate_flexion():
    angles = [_hip_angle("leftHip", 125), _hip_angle("rightHip", 125)]
    assert classify_posture_bucket(angles) == "forward_flexion_moderate"


def test_severe_flexion():
    angles = [_hip_angle("leftHip", 90), _hip_angle("rightHip", 90)]
    assert classify_posture_bucket(angles) == "forward_flexion_severe"


def test_averages_across_both_hips_when_only_one_observed():
    angles = [_hip_angle("leftHip", 170)]
    assert classify_posture_bucket(angles) == "neutral"
