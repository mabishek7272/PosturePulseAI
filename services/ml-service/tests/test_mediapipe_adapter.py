"""Real integration test against the actual MediaPipe Tasks PoseLandmarker and
the downloaded .task model bundle - skipped with a clear message if the model
hasn't been fetched yet (see scripts/fetch-pose-model.sh), rather than failing
opaquely.
"""
import numpy as np
import pytest

from app.config import POSE_LANDMARKER_MODEL_PATH

pytestmark = pytest.mark.skipif(
    not POSE_LANDMARKER_MODEL_PATH.exists(),
    reason=f"Pose landmarker model not found at {POSE_LANDMARKER_MODEL_PATH} - run scripts/fetch-pose-model.sh first.",
)


def test_no_person_in_random_noise_image_returns_no_landmarks():
    import mediapipe as mp

    from app.pose.mediapipe_adapter import MediaPipePoseAdapter

    adapter = MediaPipePoseAdapter()
    try:
        arr = (np.random.rand(480, 640, 3) * 255).astype(np.uint8)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=arr)
        landmarks = adapter.detect_on_image(image)
        assert landmarks == []
    finally:
        adapter.close()


def test_missing_model_file_raises_file_not_found():
    from pathlib import Path

    from app.pose.mediapipe_adapter import MediaPipePoseAdapter

    with pytest.raises(FileNotFoundError):
        MediaPipePoseAdapter(model_path=Path("/nonexistent/model.task"))
