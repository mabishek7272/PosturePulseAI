# ADR-018: Measurement method scope and the Study A validation strategy

## Status
Accepted.

## Context
Every posture number this product produces is an unvalidated engineering estimate.
`docs/claims-and-scope.md`'s claims ladder caps the product at "not yet evidenced" until
Study A (technical feasibility) completes, and `services/ml-service/app/config.py`'s
quality thresholds are documented as placeholders "until Study A produces real accuracy
data". Study A needs a reference method to compare against. Three candidates were
considered: a markerless multi-camera 3D pipeline (OpenCap, itself built on OpenSim), a
single physiotherapist doing manual goniometry and plumb-line photography, and building
our own multi-camera rig. The product's own measurement method also needed a decision,
independent of Study A: whether to ship anything beyond the current single-camera
MediaPipe pipeline.

Three archives were downloaded and evaluated for inclusion in this repository or its
toolchain: `mediapipe-master.zip`, `opencap-core-main.zip`, `opensim-models-master.zip`.
None was extracted into the project; the evaluation below is from inspecting each
archive's manifest and key files without unpacking into the working tree.

## Decision

### 1. The product measures with MediaPipe 2D, single camera, image plane — and nothing else ships
`services/ml-service/app/metrics/static_metrics.py` computes every metric from one
camera's roll-corrected pixel landmarks (`docs/superpowers/specs/2026-10-23-m1-static-battery.md`,
Slice A). This ADR records that as the committed scope: no second camera, no depth
sensor, no markerless 3D reconstruction is added to the shipped pipeline. A future ADR
would be needed to change this, not a code change alone.

### 2. Study A's reference method is a physiotherapist's manual measurement
Goniometry and plumb-line-on-photo, performed by a licensed physiotherapist, is the
primary and sufficient reference for Study A. The operational protocol is
`docs/phase4/technical-validation-study-protocol.md`.

### 3. Markerless 3D (OpenCap/OpenSim) is evaluated and deferred
OpenCap was the leading alternative: an open-source pipeline (Apache-2.0) that estimates
3D marker positions and OpenSim joint angles from two or more synchronized videos. It was
rejected as a near-term reference method for reasons specific to this project, not as a
general critique of the tool:

- **Hardware we do not have.** OpenCap's own README states a CUDA GPU with at least 4 GB
  of VRAM is the floor to run at all, and 8 GB is needed to reproduce the pose-estimation
  settings OpenCap's own published accuracy figures are based on; 24 GB is used for their
  high-resolution setting. Neither the engineering Mac used to build this product nor the
  shared Ubuntu deployment server has a GPU. A 6 GB laptop GPU was considered and rejected:
  it clears OpenCap's bare floor but not the setting its accuracy claims rest on, which
  would make our own "reference" unvalidated in turn.
- **A second, incompatible toolchain.** OpenCap requires a separate OpenSim installation
  (via a conda package, not pip), Visual Studio C++ build tools on Windows, and pins
  2021-era Python dependencies (`tensorflow-gpu==2.9.3`, `opencv-python==4.5.1.48`,
  `protobuf==3.19.5`) that would conflict with this repository's MediaPipe/NumPy stack if
  installed into the same environment. It would need to run in full isolation from
  `services/ml-service`.
- **Third-party cloud by default.** OpenCap's standard workflow uploads recorded video to
  `api.opencap.ai`, and even its "local" processing mode syncs results back to that cloud
  database. Sending volunteer video to a third-party US service needs its own explicit
  consent item and a data processing agreement; the existing `research_data_export`
  consent scope (`docs/consent-and-retention.md`) does not cover this.
- **"Bring your own video" is unsupported upstream.** OpenCap's README names three usage
  modes; the one that would let it process clips from this product's own capture pipeline
  is documented by OpenCap itself as "under development... will be released soon" — not a
  usable path today.
- **The deeper reason: a 3D joint angle is not the same quantity as our 2D image-plane
  angle.** Even with working hardware, OpenCap's OpenSim-derived hip/knee/shoulder angles
  are computed from a musculoskeletal model fit to 3D marker trajectories. Our metrics are
  signed 2D projections of MediaPipe's pixel landmarks (see `static_metrics.py`'s module
  docstring). Pairing the two without a documented per-metric comparability argument would
  silently misrepresent what was actually compared — exactly the failure mode CLAUDE.md
  rule 3 exists to prevent.

`opensim-models-master.zip` (56 `.osim` model files, geometry, and tutorials) was
inspected and found to contain no engine — OpenSim's inverse-kinematics solver is not in
the archive — and **no LICENSE file**, so its terms of use are unconfirmed. It is not
usable on its own regardless of the GPU question above.

`mediapipe-master.zip` is MediaPipe's own source repository (Bazel build files, graph
definitions), Apache-2.0, and contains **no trained model weights**. It is not needed:
`services/ml-service` already depends on the published `mediapipe` Python package and
downloads the `.task` model bundle at setup time (`scripts/fetch-pose-model.sh`), which is
the correct and already-working path. Building MediaPipe from source would be weeks of
Bazel work for no capability this product is missing.

**None of the three archives is vendored into this repository.** `.gitignore` now ignores
`*.zip` at the repository root (the already-tracked `logo.zip` is explicitly kept) so a
future download cannot be committed by accident.

| Archive | Version evaluated | Source | Verdict |
|---|---|---|---|
| `mediapipe-master.zip` | `master` branch snapshot, Oct 2026 | github.com/google-ai-edge/mediapipe | Not needed — pip package + `.task` download already used |
| `opencap-core-main.zip` | `main` branch snapshot, Oct 2026 | github.com/stanfordnmbl/opencap-core | Deferred — see hardware/toolchain/cloud/comparability reasons above |
| `opensim-models-master.zip` | `master` branch snapshot, Oct 2026 | github.com/opensim-org/opensim-models | Not usable — no engine, no licence file in the archive |

### 4. What a 3D path would buy, if this decision is revisited
`app/metrics/catalog.py`'s `NOT_MEASURABLE` list has ten entries. A markerless 3D
pipeline could plausibly make three of them measurable: `static.q_angle` (needs the
patella centre and tibial tuberosity — resolvable with 3D markers or a dedicated
annotation step), `static.anterior_pelvic_tilt` (needs ASIS/PSIS, which a 3D
reconstruction could locate with a fitted pelvis model), and `static.foot_rolling` (needs
rearfoot alignment). `static.joint_moments` would additionally need a force platform, per
its own `whatWouldBeNeeded` text — 3D kinematics alone does not supply kinetics. Every
other entry stays unmeasurable regardless of camera count, most notably
`static.spinal_curvature`, which needs imaging (radiography or a surface-topography
system), not motion capture of any kind.

`tests/test_catalog.py` asserts that every `NOT_MEASURABLE` key is absent from
`STATIC_METRICS`, so moving any of the three above into the registry is a deliberate,
reviewed schema and code change — never a silent reclassification.

## Consequences
- Study A proceeds without a hardware or cloud-approval blocker: a physiotherapist and a
  goniometer are sufficient to produce a complete result.
- The product's claims stay bounded to what single-camera MediaPipe can support; no
  report row will ever need to disclose a second capture device.
- If 3D is revisited later, `docs/adr/019-...` (or later) should restate this decision
  rather than silently layering a second pipeline onto the report (see Part 2 of
  `docs/superpowers/plans/2026-10-23-...` for the `measurementMethod` provenance field
  that keeps this possible without a breaking change).

## Follow-up
None open. This ADR documents a scoping decision already reflected in the shipped code
(`static_metrics.py` has no 3D or multi-camera path) and in the study protocol
(`docs/phase4/technical-validation-study-protocol.md`).
