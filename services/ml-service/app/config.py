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

# 0..1 per-landmark visibility*presence below this is treated as not observed.
# Placeholder threshold - not clinically or empirically derived; revisit once
# Study A (docs/study-charter-skeleton.md) produces real accuracy data.
LANDMARK_VISIBILITY_THRESHOLD = float(os.environ.get("LANDMARK_VISIBILITY_THRESHOLD", "0.5"))

# Of the 33 canonical joints, how many must be "observed" for a frame to be
# quality-supported. Placeholder threshold, same caveat as above.
MIN_OBSERVED_LANDMARKS_FOR_SUPPORTED = int(os.environ.get("MIN_OBSERVED_LANDMARKS_FOR_SUPPORTED", "20"))
