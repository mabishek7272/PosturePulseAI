# PosturePulse (beAIve) — Product and Technical Knowledge Base

Last updated 2026-11-18. One file that explains the product, the science, the maths and the
logic of the app, from the purpose down to the formulas. It describes what is built and
running, and says plainly where something is only planned or unproven.

How to read it: Part 1 is for anyone. Parts 2–4 are for engineers and clinicians. Part 5 is the
rulebook and the limits. Deeper detail lives in the files listed in Part 6.

---

## Part 1 — Product knowledge

### 1.1 Purpose

PosturePulse is a **clinician-supervised posture measurement tool**. A clinician films a
patient standing still from four sides with an iPad or iPhone. The system finds the body's
joints in the video and reports **objective angles and offsets, each with its uncertainty**.
The clinician reads those numbers, adds their own judgement and signs a report.

The problem it addresses: posture is normally judged by eye or with a plumb line and a
protractor. That is slow, differs between observers and leaves no record. This tool makes the
measurement repeatable and stores it, so the same person can be compared with themselves over time.

What it deliberately is **not**:
- Not a diagnosis tool. It never names a condition.
- Not clinically validated. No validation study has been run yet.
- Not a scoring tool. There is no "posture score", grade, or normal/abnormal label.
- Not autonomous. Interpretation is written by a clinician, never by the software.

### 1.2 Who uses it

| Person | What they do |
|---|---|
| Clinician | Signs in, registers or picks a patient, takes consent, runs the scan, reviews and signs the report. The only role in the app. |
| Patient | Is scanned. Signs the consent. Does not use the app. |
| Clinical lead (owner/oversight) | Signs off reference values, consent wording and protocols. Nothing becomes "validated" without this. |

There is a single role in the app. There is no patient login and no self-signup.

### 1.3 The product, screen by screen

1. **Splash and login.** Animated emblem, then clinician sign-in. The app locks after 10 minutes
   idle and on return from background.
2. **Permissions.** Camera is needed. The microphone is not used, because no audio is recorded.
3. **Home.** Recent scans, quick actions.
4. **Patients.** Register or search. Names are encrypted on the server; the rest of the system
   sees only a pseudonymous id (visit code). A patient profile shows details and scan history;
   tapping a scan opens its report.
5. **Consent.** The patient is told what is recorded and how it is used. **Both the patient and the
   clinician sign** on screen before scanning. The signatures are stored on the server, encrypted.
6. **Capture.** Four views in a fixed order: **front, left side, right side, back.** A live guide
   shows whether the person is in frame, centred, and whether the device is level. A "live
   sensors" panel shows tilt, distance and confidence. Each view can be **rescanned on its own**
   without restarting the visit.
7. **Analysis.** The clip uploads; the server analyses it; the app waits.
8. **Results.** One row per measurement: value ± uncertainty, where it sits relative to a
   reference, and a plain-language note. Tap a row for **how it was measured** (landmarks and formula).
   The report can be **shared as a PDF**.
9. **History and Settings.** Past scans; toggles. Features not built yet are shown visibly disabled.

The clinician web dashboard (https://posture.beaive.com/dashboard/) offers the same data on a
desktop: patient list (names beside visit codes), session queue, report review and sign-off,
and permanent patient erasure.

### 1.4 What the report contains

Each row has: the measurement name, its value and uncertainty (for example `2.1° ± 1.5°`), its
**tier** (estimate or proxy), a **position** relative to a reference, and a fixed-template sentence.
Rows that could not be measured say **why** (for example "person cut off at the edges"). The
report ends with a space for the **clinician's own assessment**, which the software never fills.
Released reports carry a SHA-256 fingerprint so any later change is detectable.

---

## Part 2 — The science

### 2.1 What posture analysis from video can and cannot say

The app measures **visible geometry**: where the ears, shoulders, hips, knees and ankles appear,
and the angles between them relative to true vertical.

It does **not** measure spinal curvature, bone alignment, muscle tightness, pain, injury risk or
disease. A camera sees the outside of the body, and joint markers are estimated, not located on
bone. Anything the camera cannot show is reported as "not measurable", with what would be needed.

### 2.2 The reference idea (and who provides "normal")

Postural assessment traditionally compares standing alignment with an **ideal plumb-line
alignment** described in the clinical literature (for example Kendall et al., *Muscles: Testing
and Function with Posture and Pain*, 2005): ears over shoulders over hips over knees over ankles;
shoulder and hip lines level.

In the app the references are **geometric facts, not population norms**: for example "the line
through both shoulders is level, so 0°". They come from `references/posture-reference.v0-draft.json`
and are marked draft until a clinical lead signs them off. The software does not decide what is
healthy. Where no reference exists (knee frontal alignment, the plumb offsets, head–shoulder angle),
the row says so rather than inventing one.

### 2.3 Pose estimation (the AI part)

Two different models are used, on purpose.

| | On the phone | On the server |
|---|---|---|
| Model | MoveNet Lightning (17 keypoints) | MediaPipe Pose Landmarker, full (33 landmarks) |
| Job | **Guide only**: tells the operator how to frame the shot | **Measurement**: the only model whose output becomes a number |
| Output used in a result? | Never | Yes |

They are kept apart because they place joint centres slightly differently. Mixing them would add
a bias that nothing in the record could explain. The server model also has heel and foot points
that several metrics need.

The server decodes every frame, finds the 33 landmarks (each with a visibility score), and
pairs each frame with the phone's gravity reading for that instant. Frames with no pose are kept
as "no data". Nothing is filled in from neighbouring frames.

### 2.4 Why "true vertical" comes from gravity

A tilted phone makes every angle in the picture wrong by the same amount. So the phone records
which way is down, about 60 times a second, from its motion sensors. The server uses that to
rotate each frame back to level before measuring. **Left–right tilt (roll) can be corrected.
Forward–back tilt (pitch) cannot** be corrected from a flat image, so the clip is rejected if
pitch is too large.

### 2.5 LiDAR and the 2.5D path

iPad Pro and iPhone Pro models have a LiDAR depth sensor. It is used only in the optional
**AR guided setup**, to find the floor, check the distance to the person and detect obstacles.
It records a depth track beside the video.

The **measurement code that would use depth** (3D-style trunk twist and subject-to-camera turn)
is written and tested but **switched off** (ADR-020). It needs clinical sign-off and its own
reference data before it can produce anything a clinician sees. Today all measurements come from
the 2D video alone, so LiDAR does not make the numbers more accurate. It helps set up the shot.

Devices without LiDAR (iPad mini, non-Pro iPhones) use the plain camera and lose nothing in
measurement quality.

---

## Part 3 — The maths

All angles are measured against true vertical/horizontal after levelling. Notation:
"left/right" are the person's sides; `h` is body height in pixels.

### 3.1 Coordinates and levelling

Gravity is reported as a unit vector in the image frame: x right, y down, z along the camera axis.
A level phone filming upright reads about (0, 1, 0).

```
roll   φ = atan2(gx, gy)
pitch  θ = asin(|gz| / ‖g‖)
```

Each landmark is rotated about the image centre by φ before any metric is computed (per frame,
using that frame's own gravity). If the phone is nearly flat, rotation is set to zero instead of
amplifying noise. A clip is rejected when the median pitch exceeds twice the step's tolerance
(12° for the standing battery).

### 3.2 The thirteen standing metrics

Computed per frame on levelled landmarks.

**Front and back (6):**

| Metric | Formula (plain form) |
|---|---|
| Head lateral tilt | angle of the line through both ears from horizontal: `atan2(y_left − y_right, |x_left − x_right|)` |
| Shoulder line tilt | the same, using the shoulder landmarks |
| Hip line tilt | the same, using the hip landmarks |
| Trunk lateral lean | angle of hip-midpoint → shoulder-midpoint from vertical: `atan2(Δx·s, Δy_up)`; `s` flips sign for the back view so "left" always means the person's left |
| Lateral body shift | horizontal offset of shoulder-midpoint from ankle-midpoint, as % of body height |
| Knee frontal alignment | perpendicular distance of the knee from the hip→ankle line, signed inside/outside, per leg |

**Side views (7):**

| Metric | Formula (plain form) |
|---|---|
| Plumb offset (ear, shoulder, hip, knee) | `(x_part − x_ankle) · s_fwd / h × 100`, in % of height; positive = forward |
| Head–shoulder angle | ear→shoulder line from horizontal: `atan2(Δy_up, Δx_fwd)` |
| Trunk inclination | hip→shoulder forward lean from vertical: `atan2(Δx_fwd, Δy_up)` |
| Knee extension | fore–aft deviation of the knee from the hip→ankle line (0 = straight) |

**Guards:** if two landmarks coincide, or the "up" component is zero or negative (hips above
shoulders), that frame returns no value. A formula can refuse; it cannot return nonsense.

**Scale:** there is no metric distance. Percentages use the median body height in pixels. The
system can say "8% of body height forward", never "4 cm".

### 3.3 Uncertainty

Every published value carries an uncertainty, and the schema makes it mandatory.

1. **Per landmark**: `σ = f · h / max(v, v_min)`, where `v` is the landmark's visibility. Less
   visible means more uncertain. Scaling by `h` makes different distances comparable.
2. **Per angle** (small-angle propagation): `σ_angle = √(σa² + σb²) / L`, with `L` the length of
   the line. A short line is a noisy angle, which is why head angles are less certain than
   shoulder tilt.
3. **Across frames**: the value is the **median** of the usable frames (robust to bad frames), and

```
σ = √( mean(σi²)  +  (1.4826 · MAD)² )
         model term     spread term
```

The model term says how well landmarks were found; the spread term says how much the person
actually moved. A person who swayed gets a large uncertainty even if every frame was detected well.
Observed uncertainties so far run from about ±1.5° (trunk lean) to about ±10° (head tilt).

### 3.4 The stillness gate (metrics/v2)

The first second of each clip is skipped. The hip midpoint is smoothed with a 5-frame rolling
median (removes model jitter, keeps real movement). The spread of that track must stay within
**2% of body height**. If the whole hold is not still, the gate takes the **stillest continuous
run** of frames (at least 10, and at least half the hold) and measures only from that. Frames
outside it are marked unusable (`subject_moving`). Breathing-sized sway and a late step no longer
ruin a scan. A steady drift or fast sway still fails. See ADR-021. This bumped the version to
`metrics/v2`; v1 and v2 results must not be pooled.

### 3.5 Comparing two scans

Two values A and B are called "within combined uncertainty" when
`|A − B| ≤ √(σA² + σB²)`. The app then says so. It never says "improved", "worse" or "stable";
that reading belongs to the clinician.

### 3.6 Position against a reference

The estimate is the interval `[value − σ, value + σ]`. Compared with a reference value or range:

| Position | Meaning |
|---|---|
| `within` / `below` / `above` | the whole interval lies inside / under / over the reference |
| `indeterminate` | the interval overlaps a bound (touching counts as overlapping) |
| `no_reference` | there is an estimate but no reference exists |
| `not_applicable` | there is no estimate |

### 3.7 Validation statistics (built, not yet run on real data)

Study A (agreement with a reference method) and minimal detectable change (MDC) are implemented
in the ML service. MDC is built so it **refuses** to be computed from within-clip noise. It needs a
test–retest dataset (at least 30 people, at least 24 h apart). None exists yet.

---

## Part 4 — The logic of the app

### 4.1 The end-to-end journey of one clip

```
iPad/iPhone                      Backend API (NestJS)            ML service (FastAPI)
-----------                      -------------------             --------------------
film 4 views (video +            validate sidecar against        decode frames
 gravity per frame)  ──PUT──▶    schema, store file,             find 33 landmarks
                                 create AnalysisJob (same        quality-gate each frame
                                 DB transaction)                 level each frame (roll)
                                 worker claims job  ──call──▶    compute metrics + σ
                                 save each result as event ◀──   return one result per metric
                                 delete the video unless
                                 consent says keep it
```

The phone talks only to the backend. The ML service is unreachable from the internet. Jobs use
`FOR UPDATE SKIP LOCKED` so several workers can share a queue safely. Upload uses a separate
session-scoped token; a clinician token is rejected on that path.

### 4.2 The three kinds of result (never blended)

| Kind | When | Contains |
|---|---|---|
| `estimate` | measured | value, uncertainty, frames used |
| `unsupported` | the clip existed but could not be measured | one or more reason codes |
| `notMeasurable` | this data can never give this metric | the reason, and what would be needed |

There is no fourth "roughly" shape. Every requested metric yields exactly one result.

### 4.3 The quality gate (rule: never fabricate)

A metric is computed only from frames that pass every check. Otherwise the result is
`unsupported` with reasons, and no corrective cue is shown.

Reason codes: `insufficient_landmarks`, `out_of_frame`, `occlusion`, `wrong_view`,
`camera_not_level`, `subject_moving`, `insufficient_frames`, `insufficient_frame_rate`,
`insufficient_scale`, `low_confidence`, `identity_uncertain`, `anchor_drift`.

Per frame: every needed landmark inside 2–98% of the frame; each visible (≥ 0.5); correct facing
for the view. Per clip: enough usable frames, camera level, frame rate ≥ 24 fps, body height
derivable, person still enough.

### 4.4 The live guidance on the phone

About 10 times a second the phone checks: head and feet inside the frame, keypoints confident,
distance right (head-to-ankle span 55–78% of frame height), person centred, tilt low. Each check
is **stricter than the server's**, so passing on screen means passing on the server. Keypoints are
smoothed, and a point that briefly drops keeps its last position for a short time, so the guide
does not flicker. The "Hold still" test uses the hips only (breathing moves the shoulders).

The **AR guided setup** (optional, off by default) additionally requires the floor to be found, the
person 2.3–3.0 m away, the device upright within a few degrees, nothing closer than 1.5 m in the
middle of the frame, and all of that held for 1.5 s. Tilt is smoothed and has a grace window so a
small shake does not reset it. If these thresholds feel strict on a hand-held device, they are
engineering defaults not tuned in a clinic; the plain camera is the reliable route.

### 4.5 The safety state machine

A session is an explicit state machine (XState). The governing rule: **a safety event outranks any
model output.**

| From | Event | To |
|---|---|---|
| Setup | `CALIBRATED` | Observing |
| Observing | `SUSTAINED_DEVIATION` | CueEligible |
| CueEligible | `CUE_DELIVERED` | Observing |
| Observing / CueEligible | `QUALITY_LOST` | Unavailable |
| **any non-terminal state** | `SYMPTOM_REPORTED` | **Pause** |
| **any non-terminal state** | `CONTRAINDICATION_FLAGGED` | **Pause** |

Pause and Unavailable have no automatic way out. High model confidence cannot resume a session.
A paused session refuses new clips.

### 4.6 Tiers: estimate versus proxy

A tier says whether the number **is** the thing it appears to name.

- **estimate**: measured directly (head tilt from ears, trunk lean, plumb offsets, trunk
  inclination, knee extension, lateral shift).
- **proxy**: describes landmark geometry only and stands in for a clinical idea it is not:
  shoulder-line tilt (landmark is not the acromion), hip-line tilt (not the pelvis bone points),
  head–shoulder angle (stands in for the craniovertebral angle), knee frontal alignment (stands
  in for varus/valgus). A proxy can be tracked within one person over time; it must **not** be
  compared with published ranges defined on bone anatomy. A proxy may only have a geometric reference.

### 4.7 Report text and sign-off

Row text comes from **fixed templates** filled only with the row's own numbers. A test renders
every template and fails if any banned phrase appears (condition names, normal/abnormal, risk,
score, grade). The clinician's reading goes only in `clinicianAssessment`, which the builder never
fills. A draft report can be previewed (read-only, creates no record). Sign-off re-checks the
clinician's password, sets status released and stores the SHA-256 of the canonical content.

### 4.8 Privacy, consent and retention

- **Identity is separate from data.** Names (and date of birth) are encrypted at rest (AES-256-GCM,
  key held outside the database). Everything downstream uses a pseudonymous id.
- **Consent is required** to create a session, and both signatures are stored (encrypted).
- **The video is deleted** after analysis unless consent explicitly keeps it (also on failure).
  Only derived measurements and the sidecar persist.
- **Erase everything** (clinician-only, audited, name must be typed to confirm) permanently removes a
  patient, their sessions, results, reports, consent and any stored files, in one transaction.
- Clinician passwords are bcrypt-hashed; routes are role-guarded and audited; there is no self-signup.

### 4.9 Architecture and operations

| Layer | Technology |
|---|---|
| Mobile app | Expo / React Native (Expo Router), vision-camera, TFLite |
| Clinician web | React + Vite, served at `/dashboard/` |
| Backend API | NestJS, Prisma, XState, Ajv |
| ML service | FastAPI, MediaPipe, PyAV, NumPy |
| Database | PostgreSQL 16 |
| Hosting | Docker Compose behind host nginx with TLS; app reaches a hostname so the backend can move |

Every record carries provenance: schema version, model version, adapter and calibration versions,
timestamp. A number found years later can be traced to what produced it. Schemas are the source of
truth and the bindings are generated, never hand-edited.

---

## Part 5 — Rules and limits

### 5.1 Non-negotiable rules

1. Never imply a diagnosis, validated accuracy, or a medically meaningful score. All protocols are
   `draft` and `clinicallyValidated: false` until a clinical lead signs off.
2. Safety outranks AI. A symptom or contraindication always pauses the session.
3. Never fabricate a measurement. If it cannot be measured, say `unsupported` and say why.
4. Track provenance on every record.
5. Schemas are edited in `packages/schemas/src` and regenerated.

### 5.2 Claims ladder

| Level | Claim | Status |
|---|---|---|
| A | Technical measurement with uncertainty | The target; not yet evidenced |
| B | Task-level assessment | Not built |
| C | Ergonomic exposure | Deferred |
| D | Therapeutic safety or effectiveness | Deferred; needs its own study |
| E | Disease detection or prevention | Out of scope |

### 5.3 Known limits

- **Not clinically validated.** No validation study, no test–retest data, no calibrated thresholds.
- **Uncertainty can exceed the effect of interest** (about ±1.5° to ±10°), so two scans can differ by
  more than the change a clinician is tracking. The compare view says so.
- **Capture is demanding:** whole body including heels in frame, device upright and still, about
  2.5–3.5 m of space, a stand works best. One person only in frame; a second person can steal the
  tracking without the record showing it.
- **No metric distance** (percent of height only), and spine curvature, leg length difference and
  body twist are not measurable from one 2D camera.
- **AR setup** thresholds are untuned on real devices; hand-held use often cannot satisfy them.
- A dropped upload loses the clip; the view must be repeated.
- **No AI-written interpretation exists.** Any proposal to send reports to an outside AI would
  need new consent wording, a data agreement and clinical-lead approval, because patients consented
  to measurements staying on the clinic's server.

### 5.4 Decisions that belong to people, not engineering

Reference values sign-off; consent wording review; ADR-020 (turning the depth path on); ADR-021
review; the test–retest dataset; the Study A plan; whether the standing hold lengths are right.

---

## Part 6 — Where to look next

| Topic | File |
|---|---|
| Rules and banned language | `CLAUDE.md`, `docs/claims-and-scope.md`, `references/banned-phrases.json` |
| Full technical reference | `docs/posturepulse-technical-reference.md` |
| End-to-end maths (incl. LiDAR 2.5D, signal processing) | `docs/ARCHITECTURE-end-to-end.md` |
| Coordinate frames | `docs/coordinate-frames.md` |
| Decisions | `docs/adr/` (015 tiers/positions, 018 method, 020 LiDAR, 021 stillness) |
| Hazards and traceability | `docs/hazard-analysis.md`, `docs/traceability-matrix.md` |
| Consent and retention | `docs/consent-and-retention.md` |
| Current status and handoff | `docs/HANDOFF.md`, `docs/STATUS-2026-11-06.md` |
| Standing protocol/battery data | `references/assessment-battery.v0-draft.json`, `references/posture-reference.v0-draft.json` |
| Metric formulas in code | `services/ml-service/app/metrics/`, `app/quality/` |

### Glossary

- **Landmark / keypoint:** an estimated joint position found by the pose model.
- **Roll / pitch:** device tilt left-right / forward-back.
- **Plumb line:** a vertical reference line through the body from the side.
- **Sidecar:** the data uploaded with each video (frame times, gravity per frame, device).
- **Tier:** estimate or proxy, whether the number is the thing it names.
- **Position:** within / below / above / indeterminate / no_reference.
- **MAD:** median absolute deviation, a robust measure of spread.
- **MDC:** minimal detectable change, the smallest real change beyond measurement noise.
- **Provenance:** the versions and timestamp recorded on every result.
