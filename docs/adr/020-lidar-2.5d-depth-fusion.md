# ADR-020: Single-view LiDAR 2.5D depth fusion, alongside the 2D path

## Status
Proposed. Not accepted. Requires sign-off by the clinical lead before any depth-derived
value reaches a clinician- or patient-visible report.

This ADR supersedes **ADR-018 Decision §1 only**, and only for a single-view depth sensor.
ADR-018 §2 (Study A's reference method is a physiotherapist's manual measurement) and §3
(markerless multi-camera 3D is deferred) stand unchanged.

## Context

ADR-018 §1 reads: *"no second camera, no depth sensor, no markerless 3D reconstruction is
added to the shipped pipeline. A future ADR would be needed to change this, not a code
change alone."* That decision was correct for its context — it removed a hardware and
cloud-approval blocker from Study A. This ADR revisits only the depth-sensor clause, for
three reasons that have emerged since.

### 1. There is a silent accuracy defect in the shipped 2D path
For an anterior view, `app/quality/clip_quality.py`'s view check is:

```python
if view == "anterior":
    return bool(l_sh[0] > r_sh[0])
```

That is true for *any* subject yaw below 90°. Nothing in the pipeline gates axial rotation.
A 2D coronal line tilt is inflated by `1/cos θ`, so a genuine 6° shoulder-line tilt reads
**6.9° at 30° of yaw** — and `report-builder.ts` then presents that number against a
geometric reference range as though it were a tilt. The error is invisible in the output:
nothing about a rotated capture looks different from a tilted one.

This is the strongest argument for depth, and it is not an argument for measuring in 3D. It
is an argument for *measuring the yaw* so the 2D number can be gated or corrected.

### 2. Camera pitch is rejected rather than corrected
`app/geometry/roll_correction.py` states: *"Pitch (tilt toward/away from the subject) cannot
be undone from a single 2D image, so it is only measured and used to reject the clip."*
Clips are discarded as `camera_not_level` above `2 × levelToleranceDegrees` (12° for every
step in the v0 battery) for a tilt that back-projection into a gravity-aligned frame
corrects outright.

### 3. The capability is already present and already unused
`clip-capture.schema.json` has carried an optional `intrinsics` block since v0, and the AR
jig capture path (`apps/mobile/modules/ar-jig/`) already populates it with true ARKit
intrinsics. **Zero lines of server code read that field.** The same module already reads the
LiDAR depth map every frame, reduces it to two scalars for a framing gate, and releases the
buffer. The sensor data exists, is already on the device, and is thrown away.

## Decision

### 1. A single-view 2.5D depth path is added, and it runs *alongside* the 2D path
The 2D path is unchanged and remains primary. Depth-derived results are emitted as
additional records under a `static3d.` key prefix, never as replacements for the
corresponding `static.` keys.

This is deliberate and follows directly from ADR-018 §4's warning that *"a 3D joint angle is
not the same quantity as our 2D image-plane angle."* The two methods have different bias.
Pooling them under one metric key would silently compare a depth-derived value against a
reference range derived for image-plane geometry. `report-builder.ts` already defends
against this — a result whose `provenance.measurementMethod` is not the default is forced to
`position: "no_reference"` — and that control is correct and must not be loosened. Dual-emit
accepts that 3D rows initially carry no reference comparison; the alternative (replacing the
2D method) would strip the reference comparison from *every* row in the report.

"2.5D" is used throughout rather than "3D" because there is exactly one viewpoint. No
geometry on the occluded side of the body is recovered. Calling it 3D would overstate it.

### 2. The primary purpose is to gate and de-bias the 2D metrics, not to add 3D angles
Ranked by value:

1. **`static3d.subject_yaw_to_camera`** — fixes the defect in Context §1. Raises the
   existing `wrong_view` reason above a yaw threshold, and (behind a separate flag and
   version bump) divides the 2D coronal baselines by `cos(yaw)`.
2. **Relaxed pitch gate for `static3d.*` keys only.** Gravity-frame rotation removes pitch,
   so the strict 12° limit is unnecessary for depth-derived results. The 2D keys keep it.
3. **`static3d.axial_trunk_twist`** — genuinely not obtainable in 2D, but see §4: its
   resolution floor is ±4°, so it ships as `tier: "proxy"`.

### 3. Depth is transported, not inferred
Depth travels as a separate compressed track uploaded with the clip (uint16 millimetres,
raw DEFLATE per frame, 15 Hz, with ARKit's `confidenceMap` where available). The alternative — MediaPipe's
`pose_world_landmarks`, which the pipeline currently discards — was rejected for this
purpose: those coordinates are *model-inferred* and root-relative, and
`docs/coordinate-frames.md` already states the governing rule that *"a pose model's 'world
landmarks' are relative to the body; they must not be reported as calibrated real-world
distances or angles until scale and reprojection have been checked."* A measured depth and
an inferred depth do not deserve the same provenance.

A new `measurementMethod` value, `mediapipe_2_5d_depth`, is added. The existing
`markerless_3d` value is **not** reused: it is documented as reserved for a multi-camera
pipeline, and pooling single-view LiDAR (σ ≈ 20 mm per point, extremity depth interpolated
from under one real return) with triangulated multi-camera data would corrupt the agreement
statistics in `app/analysis/agreement.py` and produce an accuracy figure that neither method
earns.

### 4. What this hardware cannot do, with the arithmetic
The iPad Pro LiDAR produces roughly 576 real returns upsampled to a 256×192 map. At 2.5 m
that is about **150 real returns/m²**, i.e. a mean spacing of 8.2 cm between independent
samples. Published figures put the point cloud at ~0.02 m precision and ~0.04 m accuracy.
Everything below follows from those numbers.

| Construct | Baseline | Angular σ per frame | Verdict |
|---|---|---|---|
| Plane normal from a 5 cm patch (e.g. at the jugular notch) | 0.05 m | `atan(0.02/0.05)` ≈ **22°** | **Not implementable.** A 5 cm × 5 cm patch at 2.5 m contains under **one** real return; the rest is interpolated from RGB |
| Torso plane normal, 4 points (shoulders + hips) | ~0.19 m | ≈ **1.8°** | Implementable |
| Shoulder yaw (2 points) | 0.38 m | ≈ **2.5°** | Implementable |
| Pelvis yaw (2 points) | 0.28 m | ≈ **3.4°** | Marginal |
| Axial trunk twist (shoulder − pelvis) | — | ≈ **4.2°** | `proxy` only, ±4° reported |
| Single heel or ankle depth | 0.07 m patch | 0.74 real returns | **Not usable.** Floor height comes from a floor-plane fit (~0.24 m², ~36 returns, σ ≈ 8 mm) |

Two consequences that must not be forgotten:

- **A 5° axial twist is not resolvable** from a single frontal capture at 2.5 m. The metric
  reports its own uncertainty and that uncertainty exceeds the effect size clinicians
  usually care about.
- **Averaging frames does not fix this.** The dominant errors are static across a static
  hold. `app/metrics/static_metrics.py` already refuses to shrink `σ_model` by frame count
  for exactly this reason, and the depth metrics inherit that refusal.

### 5. Depth error does not dominate, and 2.5D is not more precise than 2D
At Z = 2.5 m, fx = 1000 px, body height H = 1430 px:

```
σ in-plane  = 0.01 · 1430 = 14.3 px  →  × Z/fx = 0.0358 m
σ depth (random)                      =          0.0117 m
σ depth (systematic, correlated)      =          0.035 m   ← cancels in differences
```

In-plane landmark error is about **three times larger** than depth random error. The 3D
error ellipsoid is an oblate pancake, not a needle pointing along the ray. Therefore:

**2.5D buys lower bias, not higher precision.** Coronal line tilts are *not* recomputed in
3D — they would gain no precision and lose baseline. The depth budget is spent on measuring
yaw and correcting the 2D value instead.

### 6. The uncertainty model keeps its declared constant
`POSITION_SD_FRACTION = 0.01` is a documented engineering guess
(*"DRAFT - engineering defaults, not derived from data; revisit with Study A"*). It stays.

A proposal to replace it with the high-frequency residual of a low-pass filter is
**rejected**. Such a residual measures only frame-to-frame jitter. The dominant terms —
landmark-to-bony-landmark offset, soft-tissue and clothing offset, and the pose model's
left/right joint-centre asymmetry — are static or quasi-static within a clip, sit below any
cutoff usable over a short hold, and pass through the filter untouched. Substituting the
residual would shrink every reported uncertainty by an estimated 3–10× while the underlying
bias was unchanged: the instrument would claim precision it does not have. A declared guess
that is labelled as a guess is safer than a number that looks empirical and is not.

A per-clip measured jitter term is added **in quadrature**, not substituted. Where
`σ_jitter > σ_bias`, that is a clip-health diagnostic, not a precision improvement.

### 7. Minimal detectable change is out of scope for this ADR
`MDC₉₅ = 1.96·√2·SEM` requires a **between-session** SEM from a test–retest dataset.
Within-clip σ is 5–20× smaller. Deriving MDC from within-clip σ would set the threshold far
too low and flag ordinary measurement noise as real change — a false-progression path on a
real patient. No MDC figure may be computed or displayed until a test–retest dataset exists.
Until then `apps/mobile/src/lib/compare.ts` keeps its existing gate on the combined reported
uncertainty of the two scans, which makes no claim about between-visit reliability and says
so.

## Consequences

- **Nothing regresses.** `clip_quality.assess_clip` is unmodified; the depth gate runs after
  it. A depth failure suppresses only `static3d.*` keys and can never degrade a 2D result.
  Existing metric values stay byte-identical until the yaw de-bias ships under its own
  version bump.
- **3D rows carry no reference range** until a reference set is derived for the 2.5D method
  and clinically reviewed. This is `report-builder.ts`'s cross-method control working as
  designed, not a defect.
- **`is_scale_validated()` starts returning true for depth-derived records**, because reading
  real ARKit intrinsics means those records genuinely have a calibration where
  `CALIBRATION_VERSION = "none/v0"` previously asserted they did not. 2D records keep
  `none/v0`. This is a real behaviour change and needs its own test.
- **The claims ceiling is unchanged.** `docs/claims-and-scope.md` caps the product at
  Level A and states the repo is below it. Nothing in this ADR raises that ceiling. A
  physiological or neurological attribution derived from these numbers remains out of scope
  under the hard boundary that video "does not directly measure" physiology, regardless of
  how the geometry is computed.
- **Capture distance becomes a tuning parameter with real consequences.** Return density
  scales as `1/Z²`: at 1.7 m rather than 2.5 m, density rises to ~324/m², effective returns
  per torso patch rise from 2.9 to 6.4, and twist σ falls from 4.2° to ~2.8°. The AR jig's
  distance gate should be re-tuned empirically on hardware before the floors in §4 are
  treated as final.

## Follow-up

1. **Clinical lead sign-off on this ADR** before any depth-derived value appears in a
   report. Until then the depth path stays behind a flag.
2. **A hazard-analysis entry already exists for the balance manoeuvres** that motivated part
   of this work (`HZ-09`, induced fall). It is independent of this ADR and must be
   structurally enforced, not merely documented.
3. **A 2.5D reference set** must be derived and reviewed before any `static3d.*` row can be
   compared to a reference, per ADR-015's rule that a `proxy` may carry only a `geometric`
   reference.
4. **Study A's reference method is unaffected** (ADR-018 §2). If 2.5D results are to be
   validated, they need their own stratum in the agreement analysis — they must not be
   pooled with 2D results, which is why §3 adds a distinct `measurementMethod` value.
5. **Revisit ADR-018 §3** (multi-camera) only on its own merits. Nothing here makes a
   second camera more or less attractive.
