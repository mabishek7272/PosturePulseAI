# Study A operational protocol — agreement with a physiotherapist's manual measurement

Source: `docs/study-charter-skeleton.md` (Study A, the authoritative charter — every
clinical decision it marks TBD stays TBD here), `docs/phase4/statistical-analysis-plan.md`
(the statistics this protocol feeds), `docs/adr/018-measurement-method-and-validation-strategy.md`
(why the reference method is a physiotherapist's manual measurement, not a markerless 3D
system). **This document fills in the operational detail engineering may decide — which
metric pairs with which manual measurement, how exclusions are recorded, what the CSV
looks like — and leaves every clinical threshold explicitly TBD, exactly as the charter
requires.** Nothing below authorizes enrollment on its own.

## 1. What this study measures

`services/ml-service/app/metrics/static_metrics.py` computes nine static posture metrics
from a single phone camera's MediaPipe pose landmarks (`docs/adr/018`). Study A asks one
question per metric: **when a physiotherapist measures the same thing by hand, how closely
do the two agree?** "Agreement with a reference method" — never "validation," "accuracy,"
or "clinically validated" — is the only vocabulary this document and its tooling use,
per `docs/claims-and-scope.md`.

## 2. Per-volunteer procedure

1. Consent, including the `research_data_export` scope (`docs/consent-and-retention.md`)
   — required before any session data may leave the system as a research export.
2. The product's own static battery, run exactly as a real session would run it
   (front and side standing holds).
3. The physiotherapist's manual measurements, performed as a separate step, order
   randomized per volunteer (app first or physiotherapist first, alternating), with the
   physiotherapist blinded to the app's output for that volunteer until their own
   measurements are recorded.
4. For a subset of volunteers (**TBD, clinical lead** — a repeatability sub-study;
   see §6), the physiotherapist repeats their own measurements a second time, independently.

## 3. Metric comparability table

Every system value here is produced by `measurementMethod: "mediapipe_2d_image_plane"`
(single camera, 2D pixel coordinates, `+x` right / `+y` down in the image). A manual
goniometer or inclinometer reading is a different kind of measurement — a 2D image-plane
projection is not a 3D anatomical angle, and the two use different zero points and sign
conventions — so no system value may be compared against a manual value without the
explicit conversion below. The physiotherapist's data-collection sheet should record the
**raw instrument reading**; the conversion in the rightmost column is applied once, during
CSV preparation, and the raw sheet is archived separately so the conversion itself is
auditable.

### 3.1 Included — direct or near-direct comparison

| `metric_key` | System definition (`static_metrics.py`) | System sign convention | `reference_instrument` | Manual landmarks (axis / arms) | Reference-to-system conversion |
|---|---|---|---|---|---|
| `static.shoulder_line_tilt` | Angle of the inter-shoulder line from horizontal | `+` = person's left shoulder lower | `digital_inclinometer` | Palpated left and right acromion | Inclinometer reads absolute tilt magnitude; sign it `+` if the left acromion is palpated lower, `-` if the right is lower |
| `static.hip_line_tilt` | Angle of the inter-hip-landmark line from horizontal | `+` = person's left hip landmark lower | `digital_inclinometer` | Palpated left and right ASIS | Same as above; note hip-landmark MediaPipe output has higher soft-tissue variance than a palpated ASIS, so expect a larger bias here than for the shoulder line |
| `static.head_lateral_tilt` | Angle of the inter-ear line from horizontal | `+` = left ear lower | `universal_goniometer` | Axis: glabella. Stationary arm: true vertical. Moving arm: inter-tragal line | Sign `+` if left tragus is lower, `-` if right |
| `static.trunk_lateral_lean` | Angle of hip-midpoint→shoulder-midpoint line from vertical, sideways component | `+` = trunk leans toward person's left | `plumb_line_photo` | A plumb line dropped from C7; lateral deviation of C7 from the line measured at mid-pelvis height | Sign `+` if C7 is left of the plumb line, `-` if right |
| `static.knee_frontal_alignment` (`left`, `right`) | `180° −` interior hip-knee-ankle angle in the front view, signed toward midline | `+` = knee displaced toward the midline (valgus) | `universal_goniometer` | Axis: patella centre. Arms: ASIS to mid-malleoli | If the goniometer reads the interior lateral angle `θ_lat` (175° = 5° valgus by convention): `reference_value = 180° − θ_lat` (valgus positive, varus negative) |

### 3.2 Included as a proxy only, with the structural offset documented

| `metric_key` | Why it is a proxy, not clinical CVA | `reference_instrument` | Conversion / caveat |
|---|---|---|---|
| `static.head_shoulder_angle` | Clinical craniovertebral angle is measured C7-to-tragus. MediaPipe has no C7 landmark; this metric uses the shoulder landmark instead (`static.craniovertebral_angle` is listed in `NOT_MEASURABLE` for exactly this reason). The shoulder-ear triangle and the C7-tragus triangle are not the same geometric object. | `universal_goniometer` (axis: C7, stationary arm: horizontal, moving arm: line to tragus) | Record both the goniometer's clinical CVA **and** the shoulder-ear angle as separate columns if feasible, so the fixed structural offset between them can be characterized rather than assumed. Do not treat this pair as if it measured the same angle. |
| `static.trunk_inclination` | A single hip-to-shoulder line mixes pelvic and lumbar contribution; it is not a segmental spinal measurement. | `universal_goniometer` (axis: greater trochanter, stationary arm: vertical plumb, moving arm: lateral acromion) | Direct sign match: `+` when the acromion is anterior to the trochanter's plumb line (forward lean), `-` when posterior. |
| `static.plumb_offset_ear`, `_shoulder`, `_hip`, `_knee` | Percent-of-stature offsets from the ankle landmark, lateral view. Comparable to a plumb-line-and-ruler measurement **only when `cm` is meaningful** — see the scale gate in §4. | `anthropometric_tape` + `plumb_line` | A plumb line dropped from the ankle landmark's surface projection; ruler distance to each palpated landmark, signed `+` anterior / `-` posterior per the system's own `s_fwd` convention. Only usable once converted to the same unit — percent-of-stature vs. centimetres — see §4. |

### 3.3 Excluded — no valid pairing, not attempted

| `metric_key` | Reason |
|---|---|
| `static.knee_extension` | Dynamic-hold measurement reliability for hyperextension at standing rest is not established; deferred alongside the functional-movement metrics (M2) rather than paired speculatively. |
| `static.lateral_body_shift` | Shoulder-midpoint-to-ankle-midpoint offset has no single-instrument manual equivalent a physiotherapist can reliably reproduce standing; would need a force platform's centre-of-pressure trace, which is out of scope for this study. |
| Every `NOT_MEASURABLE` entry (`static.q_angle`, `static.craniovertebral_angle`, `static.forward_shoulder_angle`, `static.anterior_pelvic_tilt`, `static.spinal_curvature`, `static.foot_rolling`, `static.weight_distribution`, `static.ground_reaction_force`, `static.joint_moments`, `static.muscle_activity`) | The system produces no value for these (`app/metrics/catalog.py`); there is nothing to pair. |

## 4. Scale gate for `cm`/percent-of-stature metrics

`static.plumb_offset_*` metrics are reported as `percent_stature`. Converting a manual
ruler measurement (centimetres) into the same comparison requires the session's own
`subject_specific` scale calibration (`docs/adr/008-scale-calibration-scope.md`) to have
completed — i.e., height entry plus observed ankle/nose landmarks. If a session's scale
calibration did not complete, every `plumb_offset_*` row for that session is recorded with
`excluded_reason: missing_subject_specific_scale` and left out of the agreement
statistics, per `docs/traceability-matrix.md`'s existing note that `scaleValidated` stays
`false` for any such session.

## 5. Active range, not passive

The camera pipeline observes **active** posture — the volunteer holding their own
position — never a clinician-applied passive stretch. A goniometer reading taken with
manual overpressure (passive range) is systematically different from active range and
would introduce a predictable negative bias unrelated to the camera's own error. **The
physiotherapist must measure the same active, self-held position the camera observed** —
a static standing hold, not an end-range passive stretch — for every paired metric in this
protocol.

## 6. Reference repeatability

A subset of volunteers (**TBD, clinical lead** — recommend at least 20% of enrolled
volunteers, re-measured within the same session) get a second, independent pass by the
physiotherapist. Without this, disagreement between the system and the physiotherapist
cannot be split between "the system's error" and "the physiotherapist's own measurement
is not perfectly repeatable" — both are real, and only the repeatability sub-study
separates them. `app/analysis/agreement.py` (Part 3) reports this as a within-subject
standard deviation and coefficient of repeatability alongside the system/reference
agreement for each stratum.

## 7. Exclusion handling

Any metric the pipeline itself reports as `unsupported` or `notMeasurable` for a given
session is recorded with `excluded_reason: pipeline_unsupported` and **no numeric
`system_value`** — never zero-filled, per CLAUDE.md rule 3 — and is counted toward that
stratum's valid-sample rate (`compute_valid_sample_rate()`,
`app/analysis/technical_feasibility.py`) rather than silently dropped.

## 8. Consent and data egress

Every volunteer's consent record must include the `research_data_export` scope before
their session data is exported into the Study A dataset (`docs/consent-and-retention.md`
§"Research export and clinician free text"). No external cloud service receives any
volunteer data under this protocol — the reference measurements are collected on paper or
a local spreadsheet by the physiotherapist, not uploaded anywhere.

## 9. Prespecified acceptance thresholds — TBD, clinical lead sign-off required

Per `docs/study-charter-skeleton.md`, engineering does not set clinical acceptance
bounds. `app/analysis/run_agreement.py` (Part 3) will print `thresholdStatus: "not set"`
for every stratum below until this table is completed and signed.

| `metric_key` | Side | `reference_instrument` | Max acceptable |bias| | Max acceptable 95% LoA half-width | Min acceptable ICC(2,1) lower 95% CI | Min valid-sample rate | Sign-off |
|---|---|---|---|---|---|---|---|
| `static.shoulder_line_tilt` | — | `digital_inclinometer` | **TBD** | **TBD** | **TBD** | **TBD** | **Pending** |
| `static.hip_line_tilt` | — | `digital_inclinometer` | **TBD** | **TBD** | **TBD** | **TBD** | **Pending** |
| `static.head_lateral_tilt` | — | `universal_goniometer` | **TBD** | **TBD** | **TBD** | **TBD** | **Pending** |
| `static.trunk_lateral_lean` | — | `plumb_line_photo` | **TBD** | **TBD** | **TBD** | **TBD** | **Pending** |
| `static.knee_frontal_alignment` | `left` / `right` | `universal_goniometer` | **TBD** | **TBD** | **TBD** | **TBD** | **Pending** |
| `static.head_shoulder_angle` | `left` / `right` | `universal_goniometer` | **TBD** | **TBD** | **TBD** | **TBD** | **Pending** |
| `static.trunk_inclination` | `left` / `right` | `universal_goniometer` | **TBD** | **TBD** | **TBD** | **TBD** | **Pending** |
| `static.plumb_offset_ear` | `left` / `right` | `anthropometric_tape` | **TBD** | **TBD** | **TBD** | **TBD** | **Pending** |
| `static.plumb_offset_shoulder` | `left` / `right` | `anthropometric_tape` | **TBD** | **TBD** | **TBD** | **TBD** | **Pending** |
| `static.plumb_offset_hip` | `left` / `right` | `anthropometric_tape` | **TBD** | **TBD** | **TBD** | **TBD** | **Pending** |
| `static.plumb_offset_knee` | `left` / `right` | `anthropometric_tape` | **TBD** | **TBD** | **TBD** | **TBD** | **Pending** |

## 10. Sample size

Use `bland_altman_sample_size()` (`app/analysis/sample_size.py`) per metric once an
assumed SD of differences is available (pilot data or literature — TBD, not computed
here). **Its output counts paired samples, not subjects.** With 10–20 volunteers and
several trials each, reaching the required `n` for one metric does not automatically
satisfy it for all eleven strata, and pooling multiple metrics' pairs into one `n` is not
valid — each `(metric_key, side, reference_instrument)` stratum needs its own count. Plan
the number of repeat trials per volunteer accordingly once a pilot SD is available.

## 11. Forward-looking annex — not part of this study

A wider goniometry mapping exists in the engineering notes that informed this protocol,
covering dynamic range-of-motion metrics (shoulder flexion/abduction, elbow flexion, hip
flexion/abduction, knee flexion, ankle dorsiflexion) with AAOS/AMA neutral-zero reference
ranges and goniometer landmarks for each. **None of those metrics exist in
`static_metrics.py` today** — they belong to the functional-movement module (M2). This
annex is recorded so the same comparability discipline (explicit sign conversion, active-
vs-passive matching, documented exclusions) is reused once those metrics ship, rather than
re-derived from scratch; it does not authorize measuring anything beyond §3 in this study.

## 12. What this document is not

Not a completed study. Not evidence that any threshold has been met — every threshold in
§9 reads TBD until signed. Not an IRB/ethics protocol in itself; see
`docs/phase4/ethics-submission-readiness-checklist.md` for that separate requirement. The
tooling this protocol feeds (`app/analysis/agreement.py`, Part 3 of this change) is
verified only against synthetic data with a known injected bias — evidence the tooling is
correct, not evidence about the system's real-world accuracy, exactly as
`docs/phase4/statistical-analysis-plan.md` already states for `technical_feasibility.py`.
