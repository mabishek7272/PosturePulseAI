"""The subject's own coordinate frame, and the torso plane it is built from.

What this buys, and what it does not
------------------------------------
`gravity_alignment` removes camera roll and pitch. What remains is the free yaw
about the vertical: the camera may be anywhere on a circle around the subject,
and the subject may be turned anywhere within it. Measuring angles in the camera
frame therefore mixes the subject's posture with their stance - which is the
defect ADR-020 was written for, since `clip_quality`'s anterior view check
(`l_sh[0] > r_sh[0]`) passes any yaw below 90 degrees and a genuine 6-degree
shoulder tilt reads 6.9 at 30 degrees of yaw.

This module builds a frame fixed to the BODY, so the angles taken in it are
yaw-invariant by construction.

Why the torso plane spans the whole torso
-----------------------------------------
A small patch cannot carry a plane normal at this sensor's resolution. At 2.5 m
the map holds about 150 real returns per square metre, so:

    5 x 5 cm patch   ->  0.38 real returns  ->  sigma_normal ~ 37 degrees
    12 x 12 cm patch ->  2.16 real returns  ->  sigma_normal ~  6.5 degrees
    shoulders + hips ->  4 landmark samples ->  sigma_normal ~  1.8 degrees

So the normal is fitted across the four torso landmarks (both shoulders, both
hips, half-width ~0.19 m), not to a patch between the clavicular heads. The
enlarged 12 cm patch is still 3.7x worse than the torso-wide fit, and a patch
placed a fixed distance below the suprasternal notch sits on soft tissue for
many body types - a STATIC offset that no amount of frame averaging removes.

`MIN_TORSO_POINTS` is **4, not 3**: three points define a plane exactly, with
zero residual, so there is no way to tell a good fit from one corrupted by a
single bad depth sample. The fourth point is what makes `rms_residual` mean
something.

Sign conventions
----------------
The frame keeps **y = down**, the same as the gravity frame and the same as the
image, so every sign convention already declared in
`app/metrics/static_metrics.py` carries over unchanged. In particular
`static.shoulder_line_tilt` declares "positive = person's left shoulder lower
than the right" and is computed from `p[left][1] - p[right][1]` with y down; with
y kept down here, `y_left - y_right > 0` means the same thing in 3D. Flipping to
y = up would invert every coronal and sagittal sign while leaving every magnitude
plausible.

`e_x` runs from the patient's RIGHT to the patient's LEFT, and it is derived from
MediaPipe's own person-left / person-right landmark labels - never from the
camera frame. Taken from the camera, "image right" is the patient's left in an
anterior view and their right in a posterior one, so the tilt sign would silently
invert between views of the same body.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

#: Four, not three - see the module docstring.
MIN_TORSO_POINTS = 4

#: Smallest acceptable second singular value, metres. Below this the points are
#: effectively collinear (e.g. all four landmarks nearly in a vertical line
#: because the subject is edge-on) and the normal is undetermined about that line.
MIN_SECOND_SINGULAR_M = 0.10

#: Largest acceptable ratio of smallest to second singular value. Near 1 the
#: points fill a sphere rather than a plane and there is no normal to speak of.
MAX_SINGULAR_RATIO = 0.5

#: Largest acceptable RMS distance from the fitted plane, metres. A real torso is
#: not flat, so this is loose; it is here to catch a corrupted depth sample, not
#: to assert anatomical flatness.
MAX_PLANE_RMS_M = 0.040

#: Down, in both the gravity frame and this one.
DOWN = np.array([0.0, 1.0, 0.0])


@dataclass(frozen=True)
class TorsoPlane:
    """A fitted torso plane and the evidence for believing it."""

    #: Unit normal, oriented to point out of the chest, toward the camera.
    normal: np.ndarray
    #: Plane centroid, metres, in whatever frame the input points were in.
    centroid: np.ndarray
    singular_values: np.ndarray
    rms_residual_m: float
    n_points: int


@dataclass(frozen=True)
class AnatomicalBasis:
    """A right-handed frame fixed to the subject.

    - `e_x`: patient's right to patient's left, horizontal
    - `e_y`: down (gravity), identical to the image's y sense
    - `e_z`: `e_x x e_y`, which points POSTERIORLY - away from the subject's
      front. Named explicitly because "the third axis" is exactly the kind of
      thing that gets assumed to be anterior and silently flips a twist sign.
    """

    e_x: np.ndarray
    e_y: np.ndarray
    e_z: np.ndarray

    @property
    def matrix(self) -> np.ndarray:
        """`(3, 3)` with the basis vectors as ROWS, so `matrix @ p` gives the
        anatomical coordinates of a point `p` in the input frame."""
        return np.stack([self.e_x, self.e_y, self.e_z])

    def project(self, points: np.ndarray) -> np.ndarray:
        """`(N, 3)` points expressed in this basis."""
        p = np.asarray(points, dtype=float)
        if p.ndim == 1:
            return self.matrix @ p
        if p.ndim != 2 or p.shape[1] != 3:
            raise ValueError("points must have shape (3,) or (N, 3)")
        return p @ self.matrix.T


def fit_torso_plane(points: np.ndarray) -> TorsoPlane | None:
    """Least-squares plane through the torso landmarks, or `None` if ill-posed.

    `points` is `(N, 3)` in the gravity-aligned frame, N >= `MIN_TORSO_POINTS`,
    and must contain no non-finite value - a landmark whose depth could not be
    sampled is dropped by the caller, never passed in as `nan`.

    The normal is the right singular vector of the SMALLEST singular value of
    the mean-centred points: the direction in which the points vary least.
    """
    p = np.asarray(points, dtype=float)
    if p.ndim != 2 or p.shape[1] != 3:
        raise ValueError("points must have shape (N, 3)")
    if p.shape[0] < MIN_TORSO_POINTS or not np.all(np.isfinite(p)):
        return None

    centroid = p.mean(axis=0)
    centred = p - centroid
    # SVD of the centred points directly, rather than eigendecomposition of the
    # covariance: forming `C = Q^T Q` squares the condition number, and these
    # point sets are already close to degenerate when the subject is edge-on.
    _, s, vt = np.linalg.svd(centred, full_matrices=False)

    if s.shape[0] < 3:
        return None
    if s[1] < MIN_SECOND_SINGULAR_M:
        return None  # effectively collinear: no normal about that line
    if s[1] <= 0 or s[2] / s[1] > MAX_SINGULAR_RATIO:
        return None  # a cloud, not a plane

    normal = vt[2]
    norm = float(np.linalg.norm(normal))
    if norm < 1e-12:
        return None
    normal = normal / norm

    residuals = centred @ normal
    rms = float(np.sqrt(np.mean(residuals**2)))
    if rms > MAX_PLANE_RMS_M:
        return None

    # Orient outward from the chest, toward the lens. In frame C the optical
    # axis +z points AWAY from the camera, so a normal facing the camera has
    # negative z. SVD returns a sign-arbitrary vector, so without this the
    # normal flips between frames and the twist sign flips with it.
    if normal[2] > 0:
        normal = -normal

    return TorsoPlane(
        normal=normal,
        centroid=centroid,
        singular_values=s,
        rms_residual_m=rms,
        n_points=int(p.shape[0]),
    )


def horizontal(v: np.ndarray) -> np.ndarray | None:
    """`v` with its vertical component removed, normalised; `None` if it had none.

    Everything about yaw lives in the horizontal plane, and a vector that is
    purely vertical has no yaw to report - which is a refusal, not a zero.
    """
    u = np.asarray(v, dtype=float).reshape(3)
    if not np.all(np.isfinite(u)):
        return None
    flat = u - DOWN * float(u @ DOWN)
    norm = float(np.linalg.norm(flat))
    if norm < 1e-6:
        return None
    return flat / norm


def basis_from_landmarks(
    left_point: np.ndarray, right_point: np.ndarray
) -> AnatomicalBasis | None:
    """The subject's frame from a patient-left and a patient-right landmark.

    `left_point` and `right_point` are the LEFT and RIGHT landmarks as MediaPipe
    labels them (person-left / person-right), in the gravity-aligned frame. They
    are the sole source of laterality here; see the module docstring on why the
    camera frame cannot supply it.

    `None` when the two landmarks are vertically stacked - a fully edge-on
    subject, where the left-right direction is not observable.
    """
    left = np.asarray(left_point, dtype=float).reshape(3)
    right = np.asarray(right_point, dtype=float).reshape(3)
    e_x = horizontal(left - right)
    if e_x is None:
        return None
    e_y = DOWN
    e_z = np.cross(e_x, e_y)
    norm = float(np.linalg.norm(e_z))
    if norm < 1e-12:
        return None
    return AnatomicalBasis(e_x=e_x, e_y=e_y, e_z=e_z / norm)


def yaw_degrees(direction: np.ndarray, reference: np.ndarray | None = None) -> float | None:
    """Signed horizontal angle of `direction` from `reference`, in degrees.

    `reference` defaults to the camera's optical axis `[0, 0, 1]`, so the result
    is the yaw to the camera. Positive is a rotation about DOWN, taking
    `reference` toward `direction`; the sense is pinned by a test rather than
    left to the reader, because a yaw sign error swaps which way the subject is
    turned without changing the magnitude.
    """
    d = horizontal(direction)
    if d is None:
        return None
    r = horizontal(np.array([0.0, 0.0, 1.0]) if reference is None else reference)
    if r is None:
        return None
    # atan2 of (cross . down, dot) gives the signed angle about DOWN.
    sin_term = float(np.cross(r, d) @ DOWN)
    cos_term = float(r @ d)
    return float(np.degrees(np.arctan2(sin_term, cos_term)))


def subject_yaw_to_camera(plane: TorsoPlane) -> float | None:
    """How far the subject is turned away from facing the camera, in degrees.

    The primary deliverable of the depth path (ADR-020 section 2): it is what
    lets the 2D coronal baselines be gated and de-biased, and it is worth more
    than any new 3D angle. Zero means the chest faces the lens squarely.

    Measured from the torso-plane normal, whose per-frame sigma is about 1.8
    degrees - the best-conditioned direction available from this sensor.
    """
    # The normal points from the chest toward the camera; the camera's optical
    # axis points away from the camera. A squarely-facing subject therefore has
    # normal = -z, so the yaw is measured against -z.
    return yaw_degrees(plane.normal, reference=np.array([0.0, 0.0, -1.0]))


def chord_facing_yaw(left_point: np.ndarray, right_point: np.ndarray) -> float | None:
    """Which way a left-right landmark pair FACES, as a yaw to the camera.

    The chord runs patient-right to patient-left; the facing direction is that
    chord rotated 90 degrees about DOWN. The ORDER of the cross product decides
    which 90 degrees: `cross(chord, DOWN)` gives the posterior direction, which
    is 180 degrees from the torso normal's convention and would report a
    12-degree twist as 172. `cross(DOWN, chord)` is the anterior one.
    """
    chord = horizontal(np.asarray(left_point, dtype=float) - np.asarray(right_point, dtype=float))
    if chord is None:
        return None
    return yaw_degrees(np.cross(DOWN, chord), reference=np.array([0.0, 0.0, -1.0]))


def axial_twist_degrees(
    left_shoulder: np.ndarray,
    right_shoulder: np.ndarray,
    left_hip: np.ndarray,
    right_hip: np.ndarray,
) -> float | None:
    """Shoulder-girdle yaw minus pelvic yaw, in degrees. `tier: "proxy"`, +-4.2.

    Genuinely unavailable in 2D, which is why it is worth emitting at all.

    **Both yaws come from their own chord. The torso-wide plane normal must NOT
    be used for the shoulder term.** That normal is fitted across the shoulders
    AND the hips, so comparing it against the pelvis compares a quantity with
    part of itself: the hips pull the normal toward their own orientation and the
    twist comes out attenuated. Measured on a synthetic body with the shoulders
    turned 10 degrees against a fixed pelvis, the plane-normal form reports
    **6.5 degrees** - a 35% underestimate - and 20 degrees reads 13.1. The error
    is toward zero, so a real trunk rotation would be reported as less rotated
    than it is, which is the worse direction for a signal a clinician might use
    to decide whether something needs looking at.

    Using the two chords also matches ADR-020 section 4's budget exactly, which
    is written for "axial trunk twist (shoulder - pelvis)": shoulder yaw carries
    about 2.5 degrees from its 0.38 m chord, pelvis yaw about 3.4 from its
    0.28 m, so the difference carries about 4.2.

    A twist is a DIFFERENCE of two yaws, so it is yaw-invariant by construction:
    turning the whole subject moves both terms equally. A twist that drifts with
    stance yaw has been computed in the camera frame.

    SIGN: positive means the shoulder girdle is rotated so the person's LEFT
    shoulder is further from the camera than the pelvis would put it - i.e. the
    upper trunk is turned toward the patient's right relative to the pelvis.
    Pinned by `test_a_real_twist_is_recovered_with_the_right_sign`.

    The uncertainty is the point of the `proxy` tier: about 4.2 degrees EXCEEDS
    the effect size clinicians usually care about. A 5-degree twist is not
    resolvable from a single frontal capture at 2.5 m, and averaging frames does
    not fix it, because the dominant errors are static across a hold.
    """
    shoulder = chord_facing_yaw(left_shoulder, right_shoulder)
    pelvis = chord_facing_yaw(left_hip, right_hip)
    if shoulder is None or pelvis is None:
        return None
    return _wrap_degrees(shoulder - pelvis)


def _wrap_degrees(a: float) -> float:
    """To (-180, 180]. A twist of 350 degrees is a twist of -10."""
    return float((a + 180.0) % 360.0 - 180.0)
