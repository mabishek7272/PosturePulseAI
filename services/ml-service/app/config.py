"""Runtime configuration, read from environment variables with documented defaults."""
from __future__ import annotations

import os
from pathlib import Path

POSE_LANDMARKER_MODEL_PATH = Path(
    os.environ.get(
        "POSE_LANDMARKER_MODEL_PATH",
        str(Path(__file__).resolve().parent.parent / ".models" / "pose_landmarker_lite.task"),
    )
)

# Full (not lite) PoseLandmarker, used for clip analysis in VIDEO mode
# (POST /internal/clips/analyze). Fetched by scripts/fetch-pose-model.sh.
POSE_LANDMARKER_FULL_MODEL_PATH = Path(
    os.environ.get(
        "POSE_LANDMARKER_FULL_MODEL_PATH",
        str(Path(__file__).resolve().parent.parent / ".models" / "pose_landmarker_full.task"),
    )
)


# Face Landmarker, used for the rigid cranio-orbital head pose on ANTERIOR
# clips only (app/clips/face_video.py). Fetched by scripts/fetch-pose-model.sh.
#
# Absence is not an error: a deployment without this model simply produces no
# head-pose block, and the ear-line fallback still covers every view. Nothing in
# the analysis path requires it.
FACE_LANDMARKER_MODEL_PATH = Path(
    os.environ.get(
        "FACE_LANDMARKER_MODEL_PATH",
        str(Path(__file__).resolve().parent.parent / ".models" / "face_landmarker.task"),
    )
)


def get_clip_dir() -> Path:
    """Shared volume holding uploaded clips (written by backend-api) and the
    landmark series this service stores under `landmarks/`. Read per call so
    tests and deployments can point it elsewhere without a reload."""
    return Path(os.environ.get("CLIP_DIR", "/data/clips"))


# 0..1 per-landmark visibility*presence below this is treated as not observed.
# Placeholder threshold - not clinically or empirically derived; revisit once
# Study A (docs/study-charter-skeleton.md) produces real accuracy data.
LANDMARK_VISIBILITY_THRESHOLD = float(os.environ.get("LANDMARK_VISIBILITY_THRESHOLD", "0.5"))

# Of the 33 canonical joints, how many must be "observed" for a frame to be
# quality-supported. Placeholder threshold, same caveat as above.
MIN_OBSERVED_LANDMARKS_FOR_SUPPORTED = int(os.environ.get("MIN_OBSERVED_LANDMARKS_FOR_SUPPORTED", "20"))
