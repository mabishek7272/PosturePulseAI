"""Decodes an inbound frame submission's base64 image payload."""
from __future__ import annotations

import base64

import cv2
import mediapipe as mp
import numpy as np
import torch


def _decode_base64_to_rgb_array(image_base64: str) -> np.ndarray:
    try:
        raw = base64.b64decode(image_base64, validate=True)
    except Exception as exc:  # binascii.Error and friends
        raise ValueError("imageBase64 is not valid base64") from exc

    arr = np.frombuffer(raw, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("Could not decode image bytes - expected a JPEG/PNG-encoded image.")
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def decode_base64_image(image_base64: str) -> mp.Image:
    rgb = _decode_base64_to_rgb_array(image_base64)
    return mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)


def decode_base64_image_as_tensor(image_base64: str) -> torch.Tensor:
    """For torchvision's detection models: float tensor, shape [3, H, W], values in [0, 1]."""
    rgb = _decode_base64_to_rgb_array(image_base64)
    return torch.from_numpy(rgb).permute(2, 0, 1).float() / 255.0
