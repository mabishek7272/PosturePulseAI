"""Cranio-orbital landmarks from MediaPipe Face Landmarker, for anterior clips.

Feeds `app/geometry/head_pose.py`, which needs six rigid facial points in image
pixels. This module's only job is to produce them and to refuse when it cannot.

**The index mapping below is UNVERIFIED in this repository.** MediaPipe's
478-point face mesh is defined by its model, and the canonical geometry is not
shipped with the Python package - checked, there is no `canonical_face_model`
asset in the installed distribution - so there is nothing here to validate the
indices against. They were chosen from the published mesh topology and are
documented individually, but a wrong index would not announce itself: it would
hand the solver a point in the wrong place, and a rigid fit over six
wrongly-corresponded points still returns *a* pose.

That is why `MAX_RMS_REPROJECTION_PX` exists and is not optional. A wrong
mapping produces a set of observed points whose geometry does not match the
template, which the fit cannot explain: its reprojection residual goes from
about a pixel to tens of pixels. Measured, all 719 non-identity permutations of
the six correspondences land at 6.22 px or worse, against 3.98 px for the worst
correct fit at 3 px of landmark noise - no overlap. The gate turns a silent
wrong answer into a refusal, and `test_face_video.py` scrambles the mapping
deliberately to prove it.

Verifying the indices properly needs the model and real captures, which is
hardware work. Until then the gate is what makes this safe to run, and the
head-pose output is informational rather than a reported metric.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

#: MediaPipe face-mesh indices for the rigid cranio-orbital points.
#:
#: UNVERIFIED - see the module docstring. Each entry records what it is meant to
#: be, so a reviewer with the model in front of them can check one line at a
#: time rather than re-deriving the whole set.
#:
#:   nasion            168  bridge of the nose between the eyes, over the
#:                          frontonasal suture
#:   subnasale           2  base of the columella, over the anterior nasal spine
#:   exocanthion_right  33  outer corner of the subject's RIGHT eye
#:   exocanthion_left  263  outer corner of the subject's LEFT eye
#:   tragus_right      234  face-oval point at the subject's RIGHT ear
#:   tragus_left       454  face-oval point at the subject's LEFT ear
#:
#: MediaPipe's own left/right labels are the SUBJECT's left and right, matching
#: the body pose model and `anatomical_basis`.
#:
#: A pure left/right swap IS caught by the RMS gate, measured at 19.4 px. The
#: reason is worth recording, because the opposite is the intuitive guess: the
#: template is left-right symmetric, so a swap might seem to fit equally well.
#: It does not. Mapping template-left onto observed-right is a REFLECTION, and a
#: rigid rotation cannot produce a reflection, so the fit cannot explain the
#: points at all. Determinant +1 is doing real work here.
CRANIO_ORBITAL_INDICES: dict[str, int] = {
    "nasion": 168,
    "subnasale": 2,
    "exocanthion_right": 33,
    "exocanthion_left": 263,
    "tragus_right": 234,
    "tragus_left": 454,
}

#: Largest reprojection residual still accepted, pixels.
#:
#: The safeguard for the unverified mapping above, and the threshold is measured
#: rather than picked. Correct correspondences, 100 trials per row:
#:
#:     landmark error    RMS mean    RMS p95
#:        1.0 px          0.94 px     1.31 px
#:        1.3 px          1.22 px     1.70 px
#:        2.0 px          1.87 px     2.63 px
#:        3.0 px          2.81 px     3.98 px
#:
#: Against that, every one of the **719 non-identity permutations** of the six
#: correspondences gives an RMS of at least **6.22 px** (median 15.2, max 19.4).
#: There is no overlap: 6.0 px sits above the worst correct fit at 3 px of
#: landmark noise and below the best wrong one.
#:
#: So a mis-mapping cannot pass as a pose, which is what makes an unverified
#: index list safe to run at all.
MAX_RMS_REPROJECTION_PX = 6.0

#: Fewest frames with a usable face before a head pose is reported at all.
MIN_FACE_FRAMES = 5

#: Views with a face in them. A posterior capture has none, and a lateral one
#: shows at most half, so neither can support a rigid fit - the ear-line
#: fallback covers those.
FACE_VIEWS = ("anterior",)


@dataclass(frozen=True)
class FaceFrame:
    """One frame's cranio-orbital landmarks, in pixels of the oriented image."""

    index: int
    t: float
    landmarks_px: dict[str, tuple[float, float]]


def model_available(path: Path | None = None) -> bool:
    """Whether the Face Landmarker bundle is on disk.

    Absence is a supported state, not an error: a deployment without the model
    produces no head-pose block and the ear-line path still covers every view.
    """
    from app.config import FACE_LANDMARKER_MODEL_PATH

    return (path or FACE_LANDMARKER_MODEL_PATH).is_file()


def cranio_orbital_from_mesh(
    mesh_xy: np.ndarray,
    width: int,
    height: int,
    *,
    indices: dict[str, int] | None = None,
) -> dict[str, tuple[float, float]] | None:
    """Pick the six rigid points out of a full face mesh.

    `mesh_xy` is `(n_landmarks, 2)` in MediaPipe's NORMALISED coordinates, which
    this converts to pixels. `None` when the mesh is too small for the indices
    or carries a non-finite value - a face mesh with a nan in it is not a face
    whose orientation should be solved.
    """
    mapping = indices or CRANIO_ORBITAL_INDICES
    mesh = np.asarray(mesh_xy, dtype=float)
    if mesh.ndim != 2 or mesh.shape[1] < 2:
        raise ValueError("mesh_xy must be (n, 2) or wider")
    if mesh.shape[0] <= max(mapping.values()):
        return None

    out: dict[str, tuple[float, float]] = {}
    for name, index in mapping.items():
        x, y = float(mesh[index, 0]), float(mesh[index, 1])
        if not (np.isfinite(x) and np.isfinite(y)):
            return None
        out[name] = (x * width, y * height)
    return out


def load_face_frames(
    clip_path: Path,
    sidecar,
    *,
    view: str,
) -> list[FaceFrame]:
    """Run the Face Landmarker over the clip and return the rigid points.

    Returns an empty list - never raises - for every expected absence: a
    non-anterior view, a missing model bundle, or a clip in which no face was
    found. The head pose is additive, so its absence must never fail a clip
    whose body analysis succeeded.
    """
    if view not in FACE_VIEWS or not model_available():
        return []

    try:
        return _run_face_landmarker(clip_path, sidecar)
    except Exception:
        # Deliberately broad. This path is optional, runs a second ML model over
        # the same file, and anything it raises - a codec quirk, a model load
        # failure, a GPU delegate problem - must cost the head pose only and not
        # the clip's posture metrics.
        return []


def _run_face_landmarker(clip_path: Path, sidecar) -> list[FaceFrame]:
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import FaceLandmarker, FaceLandmarkerOptions, RunningMode

    from app.clips.pose_video import _decoded_frames  # same decode path as the body pass
    from app.config import FACE_LANDMARKER_MODEL_PATH

    options = FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(FACE_LANDMARKER_MODEL_PATH)),
        running_mode=RunningMode.VIDEO,
        num_faces=1,
        # No blendshapes or transformation matrix: this module wants landmark
        # positions only, and the pose is solved against our own template so
        # that MediaPipe's internal face-geometry solve - with its own canonical
        # model and its own conventions - does not enter the measurement.
        output_face_blendshapes=False,
        output_facial_transformation_matrixes=False,
    )

    frames: list[FaceFrame] = []
    with FaceLandmarker.create_from_options(options) as landmarker:
        for index, (rgb, timestamp_s) in enumerate(_decoded_frames(clip_path, sidecar.width, sidecar.height)):
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = landmarker.detect_for_video(image, int(timestamp_s * 1000))
            if not result.face_landmarks:
                continue
            mesh = np.array([[lm.x, lm.y] for lm in result.face_landmarks[0]], dtype=float)
            picked = cranio_orbital_from_mesh(mesh, sidecar.width, sidecar.height)
            if picked is not None:
                frames.append(FaceFrame(index=index, t=timestamp_s, landmarks_px=picked))
    return frames
