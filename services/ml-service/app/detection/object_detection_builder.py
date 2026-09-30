"""Maps RawDetection list into the object-detection-frame schema shape."""
from __future__ import annotations

from datetime import datetime, timezone

from app.detection.yolo_adapter import RawDetection
from app.geometry.coordinate_frames import CoordinateFrame


def build_object_detection_frame(session_id: str, frame_id: str, detections: list[RawDetection]) -> dict:
    return {
        "detectionFrameId": frame_id,
        "sessionId": session_id,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        # frame is always "I" (image pixels) in this phase - no 3D/O-frame
        # localization (docs/adr/006-object-detection-scope.md).
        "frame": CoordinateFrame.IMAGE.value,
        "detections": [
            {
                "label": d.label,
                "boundingBox": {"xMin": d.x_min, "yMin": d.y_min, "xMax": d.x_max, "yMax": d.y_max},
                "confidence": d.confidence,
            }
            for d in detections
        ],
    }
