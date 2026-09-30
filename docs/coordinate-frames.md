# Coordinate frames and calibration

Source: beAIve TRD §2.1. Reference for `services/ml-service/app/geometry/coordinate_frames.py`
and every schema field typed `$ref: common.schema.json#/$defs/coordinateFrame`.

## The five frames

| Symbol | Name | What it is |
|---|---|---|
| `I` | Image pixels | Raw 2D pixel coordinates in a captured frame. |
| `C` | Camera | 3D coordinates relative to the camera's optical center, using intrinsics `K` + distortion to undo the `I` projection. |
| `W` | Local AR world | A locally consistent world frame established by the device's AR tracking (ARKit/ARCore plane/mesh anchors), localized via `T_WC(t)`. |
| `B` | Body-centered skeleton | Pose-model output ("world landmarks") expressed relative to the tracked body, not a surveyed location. |
| `O` | Workstation object frame | Coordinates relative to a detected stationary object (desk, monitor, chair). |

## The rule that must never be violated

**`B` (body-centered pose) is not the same thing as a reliably surveyed position in
`W`.** A pose model's "world landmarks" are relative to the body; they must not be
reported as calibrated real-world distances or angles until scale and reprojection
have been checked against one of:

- calibrated depth,
- a known-size reference object,
- stereo / multi-view triangulation, or
- an approved subject-specific calibration.

Until one of those checks passes, report **normalized angles and relative
distances with explicit uncertainty** — never a bare metric number implying
surveyed accuracy. This is why `calibrated-joint-frame.schema.json` requires a
`scaleValidated` boolean and a `calibrationRef`, and why `session.schema.json`
carries a `calibrationRef` at the session level.

Only **approved subject-specific calibration** is implemented so far
(`services/ml-service/app/geometry/scale_calibration.py`, ADR-008) — a
clinician/patient-entered height combined with the observed ankle-to-nose
landmark span. The other three methods (calibrated depth, known-size
reference object, stereo/multi-view triangulation) remain unimplemented;
`scaleValidated` is `false` for any session that hasn't completed a real
subject-specific calibration, and stays `false` permanently for the other
three methods until they get a real implementation.

## Camera setup and localization

- **Stationary external camera mode**: requires a one-time camera-extrinsics
  calibration and a calibrated floor/work-surface reference. No continuous AR
  tracking is required, but calibration matters more than any visual overlay.
- **Moving-phone AR mode**: requires continuous device tracking (`T_WC(t)` updated
  every frame). `apps/ios-client/Sources/Spatial/ARSessionController.swift` now wraps
  `ARWorldTrackingConfiguration` and streams `camera-pose.schema.json` records
  (`services/backend-api/src/sessions/sessions.controller.ts`'s
  `POST /:id/camera-poses`), but the iOS code itself is **unverified** — no Swift
  toolchain is available in this sandbox (see `docs/adr/004-ios-dtos-hand-kept.md`
  and `apps/ios-client/README.md`). Server-side ingestion is tested. A device that
  doesn't support `ARWorldTrackingConfiguration`, or whose tracking degrades, falls
  into the first-class `TwoDFallbackBanner` mode rather than silently continuing
  under a stale or fabricated anchor.
- Do **not** use outdoor/geospatial anchors for desk-scale clinical measurement.
- Track anchor confidence and drift (`camera-pose.schema.json` → `trackingState`,
  `anchorConfidence`); re-anchor and start a new time segment when localization
  changes materially.

## The joint-angle formula

For adjacent landmarks `a, b, c` (vertex at `b`):

```
theta = acos( ((a - b) . (c - b)) / (||a - b|| * ||c - b||) )
```

with covariance propagated through from landmark position uncertainty to `theta`'s
uncertainty. This is implemented in
`services/ml-service/app/geometry/kinematics.py` (angle) and
`services/ml-service/app/geometry/covariance.py` (uncertainty propagation), and
recorded per-angle in `calibrated-joint-frame.schema.json` as `thetaRadians` /
`uncertaintyRadians` / `sourceLandmarks: [a, b, c]`.

Segment repetitions before aggregating; use robust filters that preserve rapid
events; annotate missing samples rather than smoothing over them.
