"""Metric catalog served at GET /internal/metrics/catalog: what the system
measures (with sign conventions) and what it explicitly cannot measure.

The not-measurable list is shown to clinicians as-is - it is the honest
counterpart to the measured rows, never an invitation to estimate them.
"""
from __future__ import annotations

from app.metrics.depth_metrics import catalog_entries
from app.metrics.static_metrics import STATIC_METRICS, MetricDef
from app.versioning import METRICS_VERSION

# Catalog `side` values: None = one result; "left_and_right" = one result per
# leg; "near_side" = one result for the body side facing the camera.
_SIDE_LABEL = {"none": None, "both": "left_and_right", "near": "near_side"}

NOT_MEASURABLE: list[dict[str, str]] = [
    {
        "metricKey": "static.q_angle",
        "label": "Q-angle",
        "reason": "Needs the kneecap centre and the tibial tubercle, which a body-landmark model does not locate.",
        "whatWouldBeNeeded": "Marker placement or clinician annotation of those two points on a still image.",
    },
    {
        "metricKey": "static.craniovertebral_angle",
        "label": "Craniovertebral angle",
        "reason": "Needs the seventh cervical vertebra (C7) as a reference point; the landmark model has no neck marker.",
        "whatWouldBeNeeded": "A skin marker on C7 visible in the side view, or clinician annotation of C7.",
    },
    {
        "metricKey": "static.forward_shoulder_angle",
        "label": "Forward shoulder angle",
        "reason": "Needs the seventh cervical vertebra (C7) and the shoulder joint centre, not just the shoulder landmark.",
        "whatWouldBeNeeded": "A skin marker on C7 visible in the side view, or clinician annotation of C7.",
    },
    {
        "metricKey": "static.anterior_pelvic_tilt",
        "label": "Anterior pelvic tilt",
        "reason": "Needs the front and back bony pelvic points (ASIS and PSIS); the model only gives a hip joint landmark.",
        "whatWouldBeNeeded": "Skin markers on both pelvic points in the side view, or clinician annotation.",
    },
    {
        "metricKey": "static.spinal_curvature",
        "label": "Spinal curvature angles",
        "reason": "The body-landmark model has no points along the spine, so spinal curves cannot be measured from video.",
        "whatWouldBeNeeded": "Markers or radiographic imaging reviewed by a clinician; not available in this system.",
    },
    {
        "metricKey": "static.foot_rolling",
        "label": "Foot rolling (inward or outward)",
        "reason": "Needs the shape of the foot and rear-foot alignment, which the model's heel and toe landmarks do not resolve.",
        "whatWouldBeNeeded": "A close-up view of the foot with markers, or a clinician's hands-on assessment.",
    },
    {
        "metricKey": "static.weight_distribution",
        "label": "Weight distribution between the feet",
        "reason": "Weight cannot be seen in a video.",
        "whatWouldBeNeeded": "A pressure-sensing platform or two scales.",
    },
    {
        "metricKey": "static.ground_reaction_force",
        "label": "Ground reaction force",
        "reason": "Forces cannot be seen in a video.",
        "whatWouldBeNeeded": "A force platform.",
    },
    {
        "metricKey": "static.joint_moments",
        "label": "Joint moments",
        "reason": "Moments need forces and body-segment masses, which are not observable here.",
        "whatWouldBeNeeded": "A force platform with a three-dimensional motion-capture system.",
    },
    {
        "metricKey": "static.muscle_activity",
        "label": "Muscle activity (EMG)",
        "reason": "Muscle activation is not visible in a video.",
        "whatWouldBeNeeded": "Surface electromyography sensors.",
    },
]


# How each 2D value is computed, in plain notation, written from the compute
# functions in static_metrics.py (keep them in step: test_catalog checks that
# every static metric has one). Coordinates are image pixels AFTER roll
# correction, with y pointing DOWN. s = +1 front view, -1 back view.
# f = +1 when the person faces image-right, -1 when facing image-left.
# H = vertical distance from the nose to the heel(s), pixels.
_LINE_TILT = "angle = atan2(y_left - y_right, |x_left - x_right|), using the {part} landmarks"
_KNEE = (
    "angle = 180° - ∠(hip, knee, ankle), where ∠ = acos(v1·v2 / (|v1||v2|)), "
    "v1 = hip - knee, v2 = ankle - knee; {sign}"
)
_PLUMB = "offset = 100 × f × (x_{part} - x_ankle) / H  (% of height), nearer side"
FORMULAS: dict[str, str] = {
    "static.head_lateral_tilt": _LINE_TILT.format(part="ear"),
    "static.shoulder_line_tilt": _LINE_TILT.format(part="shoulder"),
    "static.hip_line_tilt": _LINE_TILT.format(part="hip"),
    "static.trunk_lateral_lean": "angle = atan2(s × (x_shoulder-mid - x_hip-mid), y_hip-mid - y_shoulder-mid)",
    "static.lateral_body_shift": "shift = 100 × s × (x_shoulder-mid - x_ankle-mid) / H  (% of height)",
    "static.knee_frontal_alignment": _KNEE.format(sign="positive when the knee sits toward the midline of the hip-ankle line"),
    "static.plumb_offset_ear": _PLUMB.format(part="ear"),
    "static.plumb_offset_shoulder": _PLUMB.format(part="shoulder"),
    "static.plumb_offset_hip": _PLUMB.format(part="hip"),
    "static.plumb_offset_knee": _PLUMB.format(part="knee"),
    "static.head_shoulder_angle": "angle = atan2(y_shoulder - y_ear, f × (x_ear - x_shoulder)), nearer side",
    "static.trunk_inclination": "angle = atan2(f × (x_shoulder - x_hip), y_hip - y_shoulder), nearer side",
    "static.knee_extension": _KNEE.format(sign="positive when the knee sits behind the hip-ankle line"),
}

# What every 2D value shares: how points are prepared and how frames combine.
METHOD_NOTE = (
    "Landmarks come from the pose model on every frame of the hold. Each frame is first rotated by the "
    "camera roll φ = atan2(g_x, g_y) from the phone's gravity sensor, so horizontal means horizontal. "
    "The result is the median over the still frames, and ± is √(mean per-frame model variance + "
    "(1.4826 × MAD)²). It is not divided by √N, because the main errors stay the same across a hold."
)


def _entry(d: MetricDef) -> dict:
    return {
        "metricKey": d.key,
        "label": d.label,
        "module": d.module,
        "tier": d.tier,
        "unit": d.unit,
        "side": _SIDE_LABEL[d.sides],
        "signConvention": d.sign_convention,
        "description": d.description,
        "formula": FORMULAS[d.key],
        # Only implemented method this phase (ADR-018); the catalog states what
        # produces a result for this metric today, not what could in principle.
        "measurementMethod": "mediapipe_2d_image_plane",
    }


def build_catalog() -> dict:
    """2D registry entries plus the depth ones (advertised; requested only if the battery lists them)."""
    return {
        "metricsVersion": METRICS_VERSION,
        "methodNote": METHOD_NOTE,
        "metrics": [*(_entry(d) for d in STATIC_METRICS.values()), *catalog_entries()],
        "notMeasurable": [dict(item) for item in NOT_MEASURABLE],
    }
