"""The `static3d.*` metrics: what the depth path emits, and what it refuses to.

Two metrics, chosen because each earns its place rather than duplicating a 2D
number (ADR-020 section 2):

- **`static3d.subject_yaw_to_camera`** - the primary deliverable. It is what
  lets the 2D coronal baselines be gated and de-biased, and it is worth more
  than any new 3D angle, because `clip_quality`'s anterior view check
  (`l_sh[0] > r_sh[0]`) passes any yaw below 90 degrees and so nothing today
  gates axial rotation at all.

  It is the TORSO-WIDE orientation, from the plane fitted across both girdles,
  which is the best-conditioned direction this sensor offers (about 1.8 degrees
  against a chord's 2.5). A consequence to keep hold of: when the trunk is
  twisted there is no single subject yaw, and this metric reports the average -
  shoulders at 12 degrees over a pelvis at 0 reads about 7.8. That is the right
  input for the `wrong_view` GATE, and the wrong one for de-biasing a specific
  2D baseline, because `static.shoulder_line_tilt` is inflated by
  `1/cos(shoulder yaw)` and not by `1/cos(torso average)`. When the de-bias
  lands under `metrics/v2` it must use `chord_facing_yaw` on the chord it is
  correcting, not this metric.
- **`static3d.axial_trunk_twist`** - genuinely unobtainable in 2D, shipped as
  `tier: "proxy"` because its own uncertainty (about 4.2 degrees) exceeds the
  effect size clinicians usually care about.

**No coronal tilt is recomputed here.** ADR-020 section 5 is locked: the
coronal baseline is already fully in-plane, so projecting it through depth
imports depth error without adding angular leverage. Measured, the 3D coronal
tilt carries about 7.8 degrees at zero yaw against subject yaw's 2.8 - strictly
worse than the 2D number it would sit beside. Two rows for one anatomical line
where one is known to be degraded is worse than one row.

Aggregation across frames
-------------------------
`static_metrics.aggregate` is reused unchanged, which means the per-frame model
sigma is NOT divided by the frame count. That is correct rather than cautious:
the dominant errors here - the landmark-to-bony-landmark offset, soft tissue and
clothing, the pose model's left/right asymmetry, and the LiDAR's own systematic
depth bias - are static across a static hold, so averaging frames does not touch
them. A clip that reported a thirtieth of the uncertainty because it had thirty
frames would be claiming precision it did not have.

Provenance
----------
These records carry their own versions, separate from the 2D path's. In
particular `calibrationVersion` is a REAL value here rather than `"none/v0"`:
these results are computed from true ARKit intrinsics, so they genuinely have a
calibration, which 2D results do not. ADR-020's Consequences describes this as
`is_scale_validated()` starting to return True - that function belongs to the
per-frame path and the clip path never calls it, so the actual change is this
field, and nothing else.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.clips.analysis import MetricOutcome
from app.geometry.anatomical_basis import axial_twist_degrees, chord_facing_yaw, fit_torso_plane, subject_yaw_to_camera
from app.metrics.static_metrics import aggregate
from app.geometry.uncertainty3d import (
    HORIZONTAL_PLANE,
    chord_angle_sigma_degrees,
    landmark_pixel_sigma,
    twist_sigma_degrees,
)

#: Bumped whenever a `static3d.*` definition, sign convention, gate threshold or
#: the uncertainty model changes, so results computed under different rules are
#: never silently mixed. Separate from `METRICS_VERSION`: the 2D registry and
#: this one change for different reasons and must be able to move apart.
DEPTH_METRICS_VERSION = "depth-metrics/v1"

#: Real, unlike the 2D path's `"none/v0"`: these results are computed from the
#: intrinsics the device actually reported.
DEPTH_CALIBRATION_VERSION = "arkit-intrinsics/v0"

#: The single `measurementMethod` for the whole depth path. One value, not one
#: per metric, so the strata in `app/analysis/agreement.py` stay large enough to
#: mean anything.
DEPTH_MEASUREMENT_METHOD = "mediapipe_2_5d_depth"

SUBJECT_YAW_KEY = "static3d.subject_yaw_to_camera"
AXIAL_TWIST_KEY = "static3d.axial_trunk_twist"

#: Every key this module answers. `clips/service.py` splits a request's keys on
#: this: anything in it goes down the depth path, everything else down the 2D
#: registry's, which rejects keys it does not know.
DEPTH_METRIC_KEYS = (SUBJECT_YAW_KEY, AXIAL_TWIST_KEY)

#: The `metric-result` schema's `module` enum is static | functional | gait |
#: workstation | ergonomic. These metrics are "static" - a standing hold - and
#: the `static3d.` KEY prefix is what separates their namespace, so no schema
#: change is needed. The first draft of this module set `module="static3d"`,
#: which is not in the enum: every depth record would have failed validation at
#: the boundary. It never showed because nothing called the module.
DEPTH_METRIC_MODULE = "static"

#: Only the frontal views. A lateral capture puts both shoulders on one line of
#: sight, so the left-right chord has no observable horizontal extent and
#: neither metric is defined - which `basis_from_landmarks` and
#: `chord_facing_yaw` already refuse, but declaring it here means the step never
#: asks in the first place.
DEPTH_VIEWS = ("anterior", "posterior")

#: Fewest frames with a complete set of torso samples. Below this the median
#: across frames is a statement about one or two frames.
MIN_DEPTH_FRAMES = 5


@dataclass(frozen=True)
class FrameTorso:
    """One frame's torso landmarks, already sampled and gravity-aligned.

    `points` are in the gravity-aligned frame, metres. `uv` are the source video
    pixels, needed for the Jacobians. `depth_sigma` is the per-landmark depth
    sigma the sampler reported, which already carries the median-efficiency
    factor.
    """

    index: int
    points: dict[str, np.ndarray]
    uv: dict[str, tuple[float, float]]
    depth_sigma: dict[str, float]
    #: Rotation taking camera coordinates into the gravity frame `points` are in.
    #: Needed to carry the uncertainty into that frame (see
    #: `chord_angle_sigma_degrees`). `None` means `points` are camera-frame, which
    #: is exact only for a level camera.
    rotation: np.ndarray | None = None
    #: Camera-frame depth `Z` per landmark. The Jacobians need it, and it is NOT
    #: the third component of a gravity-frame point once the camera is pitched.
    depth_m: dict[str, float] | None = None


@dataclass
class DepthMetrics:
    outcomes: list[MetricOutcome]
    #: Reasons that applied to the clip as a whole, for the transport-health block.
    clip_reasons: list[str] = field(default_factory=list)


REQUIRED_LANDMARKS = ("l_sh", "r_sh", "l_hip", "r_hip")


def unsupported(metric_key: str, reasons: list[str]) -> MetricOutcome:
    """A `static3d.*` result that could not be computed.

    Always a record, never an omission: a metric that silently vanished from the
    response would be indistinguishable from one that was never asked for
    (CLAUDE.md rule 3).
    """
    return MetricOutcome(
        metric_key=metric_key,
        side=None,
        module=DEPTH_METRIC_MODULE,
        tier=_TIERS[metric_key],
        unit="deg",
        sign_convention=_SIGN_CONVENTIONS[metric_key],
        reasons=list(reasons),
    )


_TIERS = {
    # The subject's orientation to the camera is a geometric property of the
    # capture, measured directly from the torso plane. It is not a posture
    # finding and carries no reference range.
    SUBJECT_YAW_KEY: "proxy",
    # `proxy` because +-4.2 degrees exceeds the effect size clinicians usually
    # care about; a 5-degree twist is not resolvable from a single frontal
    # capture at 2.5 m.
    AXIAL_TWIST_KEY: "proxy",
}

_SIGN_CONVENTIONS = {
    SUBJECT_YAW_KEY: "positive = the subject is turned so their left side is nearer the camera; 0 = squarely facing it",
    AXIAL_TWIST_KEY: "positive = the shoulder girdle is rotated toward the person's right relative to the pelvis",
}

_LABELS = {
    SUBJECT_YAW_KEY: "Subject rotation to camera",
    AXIAL_TWIST_KEY: "Trunk axial rotation",
}

_DESCRIPTIONS = {
    SUBJECT_YAW_KEY: (
        "How far the trunk is turned away from facing the camera, from the depth sensor. "
        "Used to check the capture geometry; it is not a posture measurement."
    ),
    AXIAL_TWIST_KEY: (
        "Rotation of the shoulder girdle relative to the pelvis about the vertical, from the depth sensor. "
        "Reported with its own uncertainty, which is wider than the differences usually of interest."
    ),
}


def _cam_depth(f: "FrameTorso", name: str) -> float | None:
    """Camera-frame Z for a landmark, or None to let the callee fall back to the
    point's own third component (right only when `points` are camera-frame)."""
    return None if f.depth_m is None else f.depth_m.get(name)


def catalog_entries() -> list[dict]:
    """Catalog rows for the two metrics, in the EXACT shape `build_catalog` emits
    for the 2D ones (`metricKey`, `side`, `measurementMethod`...), because
    backend-api's report builder reads that shape and refuses to invent a label
    for a metric the catalog does not describe.

    These describe DEFINITIONS, not enablement. Having them here does not make
    any report contain one: a `static3d.*` row exists only if the battery lists
    the key, so the battery stays the single switch.
    """
    return [
        {
            "metricKey": key,
            "label": _LABELS[key],
            "module": DEPTH_METRIC_MODULE,
            "tier": _TIERS[key],
            "unit": "deg",
            "side": None,
            "signConvention": _SIGN_CONVENTIONS[key],
            "description": _DESCRIPTIONS[key],
            "measurementMethod": DEPTH_MEASUREMENT_METHOD,
        }
        for key in DEPTH_METRIC_KEYS
    ]


def compute_depth_metrics(
    frames: list[FrameTorso],
    *,
    metric_keys: list[str],
    view: str,
    body_height_px: float,
    intrinsics,
    depth_present: bool = True,
) -> DepthMetrics:
    """The `static3d.*` outcomes for one clip.

    Every requested key gets exactly one outcome - an estimate or an
    `unsupported` with reasons. Nothing is omitted, and a depth failure can
    never touch a 2D result: this function does not see them.
    """
    requested = [k for k in metric_keys if k in _TIERS]
    if not requested:
        return DepthMetrics(outcomes=[])

    # Ordered from "nothing arrived" to "it arrived and could not be used", so
    # the reason a clinician reads is the earliest true one.
    if not depth_present or intrinsics is None:
        reason = "depth_unavailable"
        return DepthMetrics(
            outcomes=[unsupported(k, [reason]) for k in requested], clip_reasons=[reason]
        )
    if view not in DEPTH_VIEWS:
        return DepthMetrics(
            outcomes=[unsupported(k, ["wrong_view"]) for k in requested], clip_reasons=["wrong_view"]
        )

    usable = [f for f in frames if all(name in f.points for name in REQUIRED_LANDMARKS)]
    if len(usable) < MIN_DEPTH_FRAMES:
        reason = "insufficient_depth_samples"
        return DepthMetrics(
            outcomes=[unsupported(k, [reason]) for k in requested], clip_reasons=[reason]
        )

    sigma_px = landmark_pixel_sigma(body_height_px)
    yaw_values, yaw_sigmas, yaw_indices = [], [], []
    twist_values, twist_sigmas, twist_indices = [], [], []
    plane_failures = 0

    for f in usable:
        p = f.points
        plane = fit_torso_plane(np.stack([p[n] for n in REQUIRED_LANDMARKS]))
        if plane is None:
            plane_failures += 1
            continue

        yaw = subject_yaw_to_camera(plane)
        shoulder_sigma = chord_angle_sigma_degrees(
            p["l_sh"], p["r_sh"], f.uv["l_sh"], f.uv["r_sh"], intrinsics,
            sigma_px=sigma_px,
            sigma_depth1_m=f.depth_sigma["l_sh"],
            sigma_depth2_m=f.depth_sigma["r_sh"],
            plane=HORIZONTAL_PLANE,
            rotation=f.rotation,
            depth1_m=_cam_depth(f, "l_sh"),
            depth2_m=_cam_depth(f, "r_sh"),
        )
        pelvis_sigma = chord_angle_sigma_degrees(
            p["l_hip"], p["r_hip"], f.uv["l_hip"], f.uv["r_hip"], intrinsics,
            sigma_px=sigma_px,
            sigma_depth1_m=f.depth_sigma["l_hip"],
            sigma_depth2_m=f.depth_sigma["r_hip"],
            plane=HORIZONTAL_PLANE,
            rotation=f.rotation,
            depth1_m=_cam_depth(f, "l_hip"),
            depth2_m=_cam_depth(f, "r_hip"),
        )
        if yaw is not None and shoulder_sigma is not None:
            yaw_values.append(yaw)
            yaw_sigmas.append(shoulder_sigma)
            yaw_indices.append(f.index)

        twist = axial_twist_degrees(p["l_sh"], p["r_sh"], p["l_hip"], p["r_hip"])
        if twist is not None and shoulder_sigma is not None and pelvis_sigma is not None:
            twist_values.append(twist)
            twist_sigmas.append(twist_sigma_degrees(shoulder_sigma, pelvis_sigma))
            twist_indices.append(f.index)

    series = {
        SUBJECT_YAW_KEY: (yaw_values, yaw_sigmas, yaw_indices),
        AXIAL_TWIST_KEY: (twist_values, twist_sigmas, twist_indices),
    }

    outcomes: list[MetricOutcome] = []
    clip_reasons: list[str] = []
    for key in requested:
        values, sigmas, indices = series[key]
        if len(values) < MIN_DEPTH_FRAMES:
            # A plane that would not fit is a different failure from a patch
            # that would not sample, and they need different codes: the first is
            # about the subject's pose, the second about the sensor.
            reason = (
                "torso_plane_underdetermined"
                if plane_failures > len(usable) - MIN_DEPTH_FRAMES
                else "insufficient_depth_samples"
            )
            outcomes.append(unsupported(key, [reason]))
            if reason not in clip_reasons:
                clip_reasons.append(reason)
            continue

        value, uncertainty = aggregate(np.asarray(values), np.asarray(sigmas))
        outcomes.append(
            MetricOutcome(
                metric_key=key,
                side=None,
                module=DEPTH_METRIC_MODULE,
                tier=_TIERS[key],
                unit="deg",
                sign_convention=_SIGN_CONVENTIONS[key],
                value=value,
                uncertainty=uncertainty,
                frames_used=len(values),
                frame_indices=list(indices),
            )
        )
    return DepthMetrics(outcomes=outcomes, clip_reasons=clip_reasons)
