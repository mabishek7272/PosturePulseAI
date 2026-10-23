"""Metric catalog served at GET /internal/metrics/catalog: what the system
measures (with sign conventions) and what it explicitly cannot measure.

The not-measurable list is shown to clinicians as-is - it is the honest
counterpart to the measured rows, never an invitation to estimate them.
"""
from __future__ import annotations

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
    }


def build_catalog() -> dict:
    return {
        "metricsVersion": METRICS_VERSION,
        "metrics": [_entry(d) for d in STATIC_METRICS.values()],
        "notMeasurable": [dict(item) for item in NOT_MEASURABLE],
    }
