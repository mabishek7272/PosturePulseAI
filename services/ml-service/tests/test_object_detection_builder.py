from app.detection.object_detection_builder import build_object_detection_frame
from app.detection.yolo_adapter import RawDetection
from app.events.emitter import build_object_detection_frame_validated


def test_builds_schema_valid_frame_with_no_detections():
    frame = build_object_detection_frame("s1", "f1", [])
    validated = build_object_detection_frame_validated(frame)
    assert validated["sessionId"] == "s1"
    assert validated["frame"] == "I"
    assert validated["detections"] == []


def test_builds_schema_valid_frame_with_a_detection():
    detections = [RawDetection(label="chair", x_min=1.0, y_min=2.0, x_max=3.0, y_max=4.0, confidence=0.87)]
    frame = build_object_detection_frame("s1", "f1", detections)
    validated = build_object_detection_frame_validated(frame)
    assert validated["detections"][0]["label"] == "chair"
    assert validated["detections"][0]["boundingBox"] == {"xMin": 1.0, "yMin": 2.0, "xMax": 3.0, "yMax": 4.0}
    assert validated["detections"][0]["confidence"] == 0.87
