#!/usr/bin/env bash
# Downloads the MediaPipe Tasks Pose Landmarker (lite) model bundle used by
# app/pose/mediapipe_adapter.py. Not committed to the repo - it's a ~5.6MB
# binary asset with its own Google license, not source code.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT_DIR=".models"
OUT_FILE="$OUT_DIR/pose_landmarker_lite.task"
URL="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"

mkdir -p "$OUT_DIR"
if [ -f "$OUT_FILE" ]; then
  echo "Already present: $OUT_FILE"
  exit 0
fi

curl -sS -o "$OUT_FILE" --max-time 120 "$URL"
echo "Downloaded pose landmarker model to $OUT_FILE"
