"""Head orientation from facial landmarks, and the two-point fallback it replaces.

Why the ear line is not good enough
-----------------------------------
`static.head_lateral_tilt` today is the angle of the line between the two ear
landmarks, from the body pose model. Its uncertainty is set by one chord and one
landmark sigma:

    sigma = sqrt(2) * sigma_landmark / baseline
          = sqrt(2) * (0.01 * 1430 px) * (Z/fx) / 0.140 m
          = sqrt(2) * 35.8 mm / 140 mm
          = **20.7 degrees** at 2.5 m

(An earlier draft of this comment said 14.6 degrees, having divided by sqrt(2)
"for two points". That is wrong twice over: there is no sqrt(n) averaging across
the two endpoints of a single chord, and the sqrt(2) in the numerator is already
the combination of two independent landmark errors - dividing by it cancelled
the very term it was meant to account for. The ear line is worse than first
stated, not better.)

That is not a usable head tilt. The problem is not the sensor, it is the
arithmetic: a 140 mm baseline measured with a landmark error of 36 mm cannot do
better.

A rigid fit over several facial landmarks improves it twice over - a face model
localises on a cropped face rather than a whole body, and a least-squares fit
over `n` points averages their errors:

    construct                             sigma
    ear-to-ear, body model (today)        20.7 deg
    tragus pair, face model                2.1 deg

Measured, rather than predicted. 300 Monte-Carlo trials per row, perturbing
each landmark independently and recovering the pose:

    landmark error     roll     pitch      yaw
       1.0 px         1.19 deg  1.87 deg  1.86 deg
       1.3 px         1.55 deg  2.43 deg  2.42 deg
       2.0 px         2.40 deg  3.73 deg  3.73 deg
       3.0 px         3.64 deg  5.58 deg  5.64 deg

**The 1.5-degree target is met for ROLL, and not for pitch or yaw.** Roll - the
quantity that replaces the ear line - reaches 1.55 degrees at about 1.3 px of
landmark error. Pitch and yaw are consistently about 1.6x worse and sit in a
1.9-2.4 degree band at best.

That asymmetry is geometric, not a defect. Roll is fixed by the widest in-plane
baseline the template has, tragus to tragus at 140 mm. Pitch and yaw depend on
DEPTH differences inside the template - how far the tragi sit behind the nasion,
about 75 mm - which at 2.5 m project into only a few pixels of perspective
difference. A monocular fit cannot do better, and the honest conclusion is that
this module's roll is a usable measurement while its pitch and yaw are coarse.

My own earlier estimate of 1.18 degrees at 2 px was optimistic by a factor of
two, because it assumed all six points contribute to the full 140 mm baseline.
They do not: the nasion and subnasale sit near the roll axis and contribute
almost nothing to it, so the effective baseline is smaller than the widest one.

Below 1 degree is not reachable at any of these error levels. A head is roughly
230 mm tall, which at 2.5 m with fx = 1000 is about **92 pixels**, so even 2 px
of landmark error is an optimistic assumption rather than a conservative one.

Precision, not accuracy
-----------------------
The canonical landmark coordinates below are generic adult means. A real head
differs from them, and that difference is a **static morphology offset** that no
amount of fitting or frame-averaging removes: every frame of every clip of one
person carries the same error. So this measures **repeatability** - whether the
head is in a different orientation than it was last visit - and not absolute
orientation against an anatomical standard.

That distinction is why no accuracy figure appears anywhere in this module, and
why `docs/claims-and-scope.md` and `scripts/lint-claims.sh` between them forbid
the phrasing that would imply one.

No OpenCV
---------
`cv2.solvePnP` would do this, but `cv2` reaches this service only as a
transitive dependency of mediapipe - it is not declared in `pyproject.toml`.
Depending on another package's dependency graph for a measurement path is how a
pin elsewhere silently removes a capability here, so the solver is written out:
Gauss-Newton with a Levenberg-Marquardt damping term, on six parameters.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.geometry.gravity_alignment import rotation_to_gravity_frame
from app.geometry.intrinsics import CameraIntrinsics

#: Canonical cranio-orbital landmarks, millimetres, origin at the nasion.
#:
#: Frame: x = subject's LEFT, y = DOWN, z = POSTERIOR - the same handedness as
#: `anatomical_basis`, so a head pose and a torso frame can be compared without
#: a conversion nobody remembers to apply. The face therefore looks toward -z.
#:
#: Chosen for RIGIDITY, not for how well a landmarker finds them. Every one sits
#: on bone or on tissue bound tightly to it: the canthi are held by the medial
#: and lateral palpebral ligaments, the nasion is a suture, the subnasale sits
#: on the anterior nasal spine, and the tragus is cartilage fixed to the
#: temporal bone. Landmarks on the lips, cheeks, brows or jaw move with
#: expression and swallowing, which would appear as head rotation.
#:
#: These are generic adult means to roughly a few millimetres. See the module
#: docstring: the error that follows is a static per-person offset.
CANONICAL_LANDMARKS_MM: dict[str, tuple[float, float, float]] = {
    "nasion": (0.0, 0.0, 0.0),
    "endocanthion_left": (16.0, 3.0, 8.0),
    "endocanthion_right": (-16.0, 3.0, 8.0),
    "exocanthion_left": (45.0, 5.0, 25.0),
    "exocanthion_right": (-45.0, 5.0, 25.0),
    "subnasale": (0.0, 48.0, -5.0),
    "tragus_left": (70.0, 25.0, 75.0),
    "tragus_right": (-70.0, 25.0, 75.0),
}

#: The six-point subset the target sigma is quoted for. Both tragi carry most of
#: the roll information (the widest baseline), both exocanthia most of the yaw,
#: and the nasion and subnasale pin pitch.
RIGID_SIX = (
    "nasion",
    "subnasale",
    "exocanthion_left",
    "exocanthion_right",
    "tragus_left",
    "tragus_right",
)

#: Views the rigid fit can run in. There is no face in a posterior capture, so
#: `head_roll_from_ears` is the documented fallback there rather than a
#: degraded version of this.
RIGID_FIT_VIEWS = ("anterior",)

#: Declared uncertainty of the two-point ear-line fallback, degrees.
#:
#: Not a guess: `degrees(sqrt(2) * 0.0358 m / 0.140 m)`. The sqrt(2) is the
#: combination of two independent landmark errors at the ends of one chord;
#: there is no averaging to divide by, which an earlier draft wrongly applied
#: and arrived at 14.6.
#:
#: Carried on the result so a value from the fallback path can never be pooled
#: with a rigid-fit one or presented as the same measurement.
EAR_LINE_SIGMA_DEGREES = 20.7

MIN_POINTS = 4
MAX_ITERATIONS = 60
CONVERGENCE_STEP = 1e-9


@dataclass(frozen=True)
class HeadPose:
    """Head orientation, in the gravity-aligned frame."""

    #: Rotation taking canonical head coordinates into the gravity frame.
    rotation: np.ndarray
    #: Head origin (the nasion) in the gravity frame, metres.
    translation: np.ndarray
    #: Lateral tilt, degrees. Positive = the subject's left ear is LOWER, which
    #: matches `static.head_lateral_tilt`'s declared convention for the 2D
    #: metric so the two can never disagree in sign.
    roll_degrees: float
    #: Nod, degrees. Positive = chin down.
    pitch_degrees: float
    #: Turn about the vertical, degrees. Positive = turned toward the subject's
    #: left, matching `anatomical_basis.yaw_degrees`.
    yaw_degrees: float
    #: RMS reprojection error, pixels. The fit's own evidence.
    rms_reprojection_px: float
    n_points: int
    iterations: int
    #: Always "rigid_fit" here; the fallback reports its own.
    method: str = "rigid_fit"


def rodrigues(r: np.ndarray) -> np.ndarray:
    """Rotation matrix from a rotation vector (axis * angle)."""
    theta = float(np.linalg.norm(r))
    if theta < 1e-12:
        return np.eye(3)
    k = r / theta
    kx = np.array([[0.0, -k[2], k[1]], [k[2], 0.0, -k[0]], [-k[1], k[0], 0.0]])
    return np.eye(3) + np.sin(theta) * kx + (1.0 - np.cos(theta)) * (kx @ kx)


def project(points_mm: np.ndarray, rvec: np.ndarray, tvec: np.ndarray, k: CameraIntrinsics) -> np.ndarray:
    """Project canonical head points (mm) to image pixels.

    `tvec` is in METRES while the model is in millimetres, which is deliberate:
    the model is an anthropometric template whose natural unit is mm, and the
    scene is metric. Mixing them in one array is how a factor of 1000 hides.
    """
    camera = (rodrigues(rvec) @ (np.asarray(points_mm, dtype=float).T / 1000.0)).T + tvec
    z = camera[:, 2]
    if np.any(z <= 1e-6):
        # Behind or at the camera: there is no projection, and clamping would
        # hand the optimiser a finite residual for an impossible pose.
        raise ValueError("a model point fell at or behind the camera")
    return np.column_stack([camera[:, 0] * k.fx / z + k.cx, camera[:, 1] * k.fy / z + k.cy])


def solve_rigid_pose(
    observed_px: dict[str, tuple[float, float]],
    k: CameraIntrinsics,
    *,
    canonical: dict[str, tuple[float, float, float]] | None = None,
) -> tuple[np.ndarray, np.ndarray, float, int] | None:
    """Gauss-Newton with LM damping for `(rvec, tvec)`. `None` if it will not fit.

    Six parameters, so a numerical Jacobian is both adequate and far easier to
    be sure of than a hand-derived one; the cost is 6 extra projections per
    iteration on 6 points.
    """
    model = canonical or CANONICAL_LANDMARKS_MM
    names = [n for n in observed_px if n in model]
    if len(names) < MIN_POINTS:
        # Four points is the minimum for a unique perspective pose. Fewer is
        # under-determined, and returning the least-squares answer anyway would
        # be reporting an orientation the image does not contain.
        return None

    points = np.array([model[n] for n in names], dtype=float)
    target = np.array([observed_px[n] for n in names], dtype=float)
    if not np.all(np.isfinite(target)):
        return None

    rvec, tvec = _initial_guess(points, target, k)
    params = np.concatenate([rvec, tvec])
    damping = 1e-4

    def residual(p: np.ndarray) -> np.ndarray | None:
        try:
            return (project(points, p[:3], p[3:], k) - target).ravel()
        except ValueError:
            return None

    current = residual(params)
    if current is None:
        return None

    iterations = 0
    for iterations in range(1, MAX_ITERATIONS + 1):
        jacobian = np.zeros((current.size, 6))
        for i in range(6):
            step = np.zeros(6)
            step[i] = 1e-7 if i < 3 else 1e-7
            forward = residual(params + step)
            if forward is None:
                return None
            jacobian[:, i] = (forward - current) / step[i]

        jtj = jacobian.T @ jacobian
        try:
            delta = np.linalg.solve(jtj + damping * np.diag(np.diag(jtj)) + 1e-12 * np.eye(6), -jacobian.T @ current)
        except np.linalg.LinAlgError:
            return None

        trial = residual(params + delta)
        if trial is not None and float(trial @ trial) < float(current @ current):
            params = params + delta
            current = trial
            damping = max(damping * 0.3, 1e-10)
        else:
            # Rejected step: lean harder on the gradient direction and retry.
            damping = min(damping * 10.0, 1e6)
            if damping >= 1e6:
                break
        if float(np.linalg.norm(delta)) < CONVERGENCE_STEP:
            break

    rms = float(np.sqrt(np.mean(current**2) * 2.0))  # per-point, both axes
    return params[:3], params[3:], rms, iterations


def _initial_guess(points: np.ndarray, target: np.ndarray, k: CameraIntrinsics) -> tuple[np.ndarray, np.ndarray]:
    """Identity rotation, with depth from the apparent size of the template.

    Crude on purpose. Gauss-Newton converges from here for the head
    orientations a standing assessment produces; a full EPnP initialisation
    would be more code to be wrong in for a case that does not arise.
    """
    model_span_m = float(np.ptp(points[:, 0])) / 1000.0
    image_span_px = float(np.ptp(target[:, 0]))
    z = (model_span_m * k.fx / image_span_px) if image_span_px > 1e-6 else 2.5
    centroid = target.mean(axis=0)
    return (
        np.zeros(3),
        np.array([(centroid[0] - k.cx) * z / k.fx, (centroid[1] - k.cy) * z / k.fy, z]),
    )


def head_pose_from_landmarks(
    observed_px: dict[str, tuple[float, float]],
    gravity: np.ndarray | tuple[float, float, float],
    k: CameraIntrinsics,
    *,
    view: str = "anterior",
    canonical: dict[str, tuple[float, float, float]] | None = None,
    max_rms_px: float = 6.0,
) -> HeadPose | None:
    """Head orientation in the gravity frame, or `None` when it cannot be had.

    `None` rather than a degraded answer for: a non-anterior view (there is no
    face to fit - use `head_roll_from_ears`), too few landmarks, an unusable
    gravity reading, a fit that did not converge, or a fit whose reprojection
    residual exceeds `max_rms_px`.

    That last one is the guard against a wrong landmark correspondence, which is
    otherwise silent: six wrongly-matched points still yield *a* pose. See
    `app/clips/face_video.py` on why its mesh index mapping cannot be verified
    here, and `MAX_RMS_REPROJECTION_PX` there for the measured separation.
    """
    if view not in RIGID_FIT_VIEWS:
        return None

    r_gravity = rotation_to_gravity_frame(gravity)
    if r_gravity is None:
        return None

    solved = solve_rigid_pose(observed_px, k, canonical=canonical)
    if solved is None:
        return None
    rvec, tvec, rms, iterations = solved

    if rms > max_rms_px:
        # The fit cannot explain the landmarks it was given. The usual cause is
        # a wrong landmark correspondence - see `app/clips/face_video.py`, whose
        # mesh index mapping is unverified in this repository - and the
        # alternative is reporting an orientation derived from points that are
        # not where the template says they are. Measured, every scrambled
        # correspondence lands above this threshold and every correct fit below
        # it, so this is the check that makes an unverified mapping safe to run.
        return None

    # head -> camera, then camera -> gravity frame.
    r_head_to_gravity = r_gravity @ rodrigues(rvec)
    roll, pitch, yaw = _angles_from_rotation(r_head_to_gravity)

    return HeadPose(
        rotation=r_head_to_gravity,
        translation=r_gravity @ tvec,
        roll_degrees=roll,
        pitch_degrees=pitch,
        yaw_degrees=yaw,
        rms_reprojection_px=rms,
        n_points=len([n for n in observed_px if n in (canonical or CANONICAL_LANDMARKS_MM)]),
        iterations=iterations,
    )


def _angles_from_rotation(r: np.ndarray) -> tuple[float, float, float]:
    """Roll, pitch and yaw in degrees from a head-to-gravity rotation.

    Decomposed as the intrinsic **Z-X-Y** sequence `R = Rz(roll) Rx(pitch)
    Ry(yaw)`: roll about the optical axis, then pitch about the image-right
    axis, then yaw about the vertical. Writing the product out gives

        R[2,1] =  sin(pitch)
        R[0,1] = -sin(roll) cos(pitch)      R[1,1] = cos(roll) cos(pitch)
        R[2,0] = -cos(pitch) sin(yaw)       R[2,2] = cos(pitch) cos(yaw)

    which inverts directly. Taking the angles from the rotated AXES instead -
    reading roll off column 0 and pitch off column 1 independently - looks
    equivalent and is not, because the three rotations do not commute: a head at
    (roll 5, pitch -6, yaw 8) came back as (4.16, +6.02, 7.50), with the pitch
    sign inverted and the roll a degree out, while the pose itself was recovered
    to 5e-14 px. An angle convention is a decomposition, not a property of the
    rotation, so it has to be stated and inverted consistently.

    Signs:
    - roll: positive = the subject's left ear LOWER, matching
      `static.head_lateral_tilt`'s declared convention so the 2D metric and this
      one cannot disagree about which way a head is tilted.
    - pitch: positive = chin down.
    - yaw: positive = turned toward the subject's left, matching
      `anatomical_basis.yaw_degrees`.
    """
    pitch = float(np.arcsin(np.clip(r[2, 1], -1.0, 1.0)))
    cos_pitch = float(np.cos(pitch))
    if abs(cos_pitch) < 1e-9:
        # Gimbal case: the head is pitched a full 90 degrees, so roll and yaw
        # are the same rotation and cannot be separated. Not reachable in a
        # standing assessment, but it must not return nonsense if it is.
        roll = float(np.arctan2(-r[0, 2], r[0, 0]))
        return float(np.degrees(roll)), float(np.degrees(pitch)), 0.0
    roll = float(np.arctan2(-r[0, 1], r[1, 1]))
    yaw = float(np.arctan2(-r[2, 0], r[2, 2]))
    return float(np.degrees(roll)), float(np.degrees(pitch)), float(np.degrees(yaw))


@dataclass(frozen=True)
class EarLineRoll:
    """The two-point fallback. Carries its own, much larger, uncertainty."""

    roll_degrees: float
    sigma_degrees: float = EAR_LINE_SIGMA_DEGREES
    method: str = "ear_line"


def head_roll_from_ears(
    left_ear_px: tuple[float, float],
    right_ear_px: tuple[float, float],
) -> EarLineRoll | None:
    """Head lateral tilt from the ear line. The POSTERIOR-view path.

    Retained deliberately rather than deprecated: a posterior capture contains
    no face, so the rigid fit cannot run and removing this would leave that view
    with no head measurement at all.

    It reports `EAR_LINE_SIGMA_DEGREES` (14.6) alongside the angle, so a caller
    cannot pool it with a rigid-fit result or present the two as the same
    measurement. Same sign convention: positive = the subject's left ear lower.
    """
    left = np.asarray(left_ear_px, dtype=float)
    right = np.asarray(right_ear_px, dtype=float)
    if not (np.all(np.isfinite(left)) and np.all(np.isfinite(right))):
        return None
    dx = abs(left[0] - right[0])
    dy = left[1] - right[1]
    if float(np.hypot(dx, dy)) < 1e-6:
        return None
    return EarLineRoll(roll_degrees=float(np.degrees(np.arctan2(dy, dx))))
