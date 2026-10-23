#!/usr/bin/env bash
# Downloads the MediaPipe Tasks Pose Landmarker model bundles:
#   - lite: app/pose/mediapipe_adapter.py (per-frame /internal/frames)
#   - full: app/clips/pose_video.py (clip analysis, /internal/clips/analyze)
# Not committed to the repo - they are multi-MB binary assets with their own
# Google license, not source code.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT_DIR=".models"
BASE_URL="https://storage.googleapis.com/mediapipe-models/pose_landmarker"

mkdir -p "$OUT_DIR"

fetch() {
  local variant="$1"
  local out_file="$OUT_DIR/pose_landmarker_${variant}.task"
  local url="$BASE_URL/pose_landmarker_${variant}/float16/latest/pose_landmarker_${variant}.task"
  if [ -f "$out_file" ]; then
    echo "Already present: $out_file"
    return 0
  fi
  curl -sSf -o "$out_file.part" --max-time 300 "$url"
  mv "$out_file.part" "$out_file"
  echo "Downloaded pose landmarker ($variant) model to $out_file"
}

fetch lite
fetch full
