# PosturePulse AI — Technical Reference

Nov 3, 2026 · @reAInmaker R&D

A reference for the engineers and clinicians working on the posture and movement assessment platform. It describes what the system actually implements today, not what is planned.

## 1. System overview

## 1. System overview

The platform measures standing posture from short video clips and returns objective angles with their uncertainty. It does not diagnose, score or interpret: a clinician does that.

A session runs in one sitting on a shared clinic iPad:

1. The clinician signs in. The device locks after 10 minutes idle.
2. They select an existing patient or create one. Patient names are encrypted; everything downstream uses a pseudonymous subject id.
3. They record consent, which creates a consent record the session is bound to.
4. The app captures four standing views in a fixed order: front (anterior), left side, right side, back (posterior). Each is a 30-second hold recorded as video, with the phone's gravity direction sampled per frame.
5. Each clip uploads to the clinic server with a sidecar describing the recording.
6. The server runs pose estimation over every frame, discards frames that fail quality checks, and computes each metric only from frames that passed.
7. The app shows the measurements, each as a value with an uncertainty, or an explicit statement that it could not be measured and why.

Four pieces make this up:

| Component | Role |
| --- | --- |
| Mobile app | Capture, guidance, consent, results. The clinician's whole workflow. |
| Backend API | Sessions, patients, consent, clip intake, job queue, safety state. |
| ML service | Pose estimation, quality gating, metric computation. The only CPU-bound part. |
| Postgres | Records, events and the analysis job queue. |

The measurement happens on the server, not the phone. The phone runs a separate, lighter pose model purely to help the operator frame the shot; it never contributes to a measurement. Sections 5 and 6 cover that split, which matters because the two are easy to confuse.

## 2. Architecture and technology stack

## 2. Architecture and technology stack

Three services behind one nginx host, sharing one Postgres database.

| Layer | Technology | Version |
| --- | --- | --- |
| Mobile app | Expo / React Native, Expo Router | Expo 58.0, RN 0.88.1 |
| Camera | react-native-vision-camera | 5.2.4 |
| On-device pose | react-native-fast-tflite, MoveNet Lightning | 3.0.1 |
| Animation and drawing | Reanimated, react-native-svg | 4.7.1, 15.16 |
| Device motion | expo-sensors (DeviceMotion) | 58.0 |
| Token storage | expo-secure-store (iOS Keychain) | 58.0 |
| Backend API | NestJS | 10.4 |
| ORM | Prisma | 5.22 |
| Safety state machine | XState | 5.19 |
| Schema validation | Ajv | 8.17 |
| Password hashing | bcryptjs | 3.0 |
| ML service | FastAPI / Uvicorn | 0.115 / 0.32 |
| Pose estimation | MediaPipe Tasks | 1.x |
| Video decode | PyAV | 14-19 |
| Numerics | NumPy | 1.26+ |
| Database | PostgreSQL | 16 |

### How a clip travels

The mobile app talks only to the backend API over HTTPS. The ML service is not exposed to the internet; nothing outside the Docker network can reach it.

1. The app `PUT`s the clip and its sidecar to the backend as multipart form data.
2. The backend validates the sidecar against the schema, stores the file, and creates a row in `AnalysisJob` inside the same transaction as the clip row. The job only becomes visible to a worker at commit, after the file is in place.
3. Workers claim jobs with Postgres `FOR UPDATE SKIP LOCKED`, so several workers can drain the queue without stepping on each other. Concurrency is a configuration value, currently four.
4. A worker calls the ML service, which reads the clip from a shared volume, runs pose estimation, gates quality and returns one result per requested metric.
5. The backend writes each result as an event and deletes the clip file unless the session's consent says to keep it.

### Two sessions of authentication

A clinician's JWT authenticates the workflow. Clip upload uses a different, session-scoped token issued when the session is created, and the upload guard rejects a clinician token outright. That keeps a clinician's long-lived credential out of the upload path.

## 3. Data contracts and provenance

## 3. Data contracts and provenance

Every record in the system is defined by a JSON Schema, and every emitted record carries the versions that produced it. There are 22 schemas; the generated language bindings are built from them, never hand-written.

The ones that carry the measurement are:

| Schema | What it holds |
| --- | --- |
| `clip-capture` | The sidecar uploaded with each clip: dimensions, frame times, per-frame gravity, device. |
| `pose-landmark-frame` | Landmarks detected in one frame. |
| `quality-gate-flag` | The reason vocabulary for rejecting a frame or a clip. |
| `metric-result` | One measurement, in one of three mutually exclusive forms. |
| `reference-range-set` | Reference ranges, when a validated set exists. |
| `assessment-battery` | The steps of a protocol: views, metrics, thresholds. |
| `assessment-report` | The clinician-facing report and its sign-off. |
| `consent-record`, `session` | Consent scope and session lifecycle. |
| `symptom-report`, `adverse-event-record` | Safety inputs. |

### A result is one of three things, never a blend

`metric-result` uses a schema-level `oneOf` across exactly three shapes, so a result cannot be partly measured:

- **`estimate`** — a `value`, an `uncertainty` in the same unit, and `framesUsed`. Uncertainty is required, so a number can never be published without one.
- **`unsupported`** — one or more reason codes from the quality vocabulary. The clip existed but could not be measured, and the reasons say why.
- **`notMeasurable`** — a `reason` and `whatWouldBeNeeded`. This metric cannot be derived from this kind of data at all, and the record states what it would take.

This is the structural expression of the rule that the system never guesses. There is no fourth shape meaning "roughly".

### Tiering

Each result also declares a `tier`: `estimate`, `proxy`, `entered`, `annotated` or `not_measurable`. The distinction that matters clinically is between `estimate`, a measurement that is not yet clinically evidenced, and `proxy`, a number that stands in for a named clinical construct without being that construct. Section 11 covers what that means at the bedside.

### Provenance

Every record carries a `provenance` block, required on all of them:

- `schemaVersion` — the version of the record's own schema
- `modelVersion` — the model or adapter that produced it, for example `mediapipe-pose/0.10.9`
- `adapterVersion` and `calibrationVersion`
- `producedAt`

The point is that a number found in the database three years from now can still be traced to the exact model and calibration that produced it. Schemas are generated artefacts: the sources in `packages/schemas/src` are edited, and the bindings are regenerated and committed.

## 4. Capture pipeline

## 4. Capture pipeline

Each view is a 30-second video recorded in portrait, uploaded with a sidecar that describes the recording frame by frame. The sidecar is what makes the measurement possible: without knowing which way was down in each frame, an angle in the image means nothing about the body.

### Camera settings

| Setting | Value | Why |
| --- | --- | --- |
| Resolution target | 1080 × 1440 portrait (3:4) | 4:3 uses the whole sensor. 16:9 crops the sides, leaving less room for a standing subject with feet apart. |
| Frame rate target | 30 fps | The battery requires at least 24 fps. |
| Bit rate target | 6 Mbit/s | About 22 MB for 30 seconds. |
| Hold length | 30 seconds | The server discards the first second, so the usable hold is about 29 seconds. |
| Audio | Off | Never recorded. |
| Orientation | Locked to the portrait interface | A tilted iPad otherwise hands the pose model sideways frames. |

These are targets. The camera pipeline resolves them against what the hardware supports, so the app reads the resolution and frame rate it actually got rather than assuming it got what it asked for.

### The gravity sidecar

While recording, the app samples device motion at roughly 60 Hz and converts each reading into a unit gravity vector in the camera's frame. Linear acceleration is subtracted first, so a moving phone still reports which way is down. Section 8 gives the conversion.

The sidecar then carries one entry per encoded frame: its index, its presentation time in seconds, and the gravity direction interpolated to that time.

Two guards stop a fabricated sidecar from being uploaded:

- **No readings at all** — the upload fails loudly. A sidecar of zeros would tell the server the phone was in free fall and silently corrupt every angle.
- **Thin coverage** — for clips longer than 1.5 seconds, the readings must span at least half the recording. A single reading held across 30 seconds would be fabricated per-frame data.

### Reading the file, not the request

The sidecar reports the dimensions and frame times taken from the recorded file itself, parsed out of its container metadata, not the values the app asked the camera for.

This matters because the server pairs decoded frame *i* with sidecar frame *i* and rejects the clip outright if the decoded size disagrees with what the sidecar claims. An earlier version reported the requested 1440 × 1920 while the camera delivered something else, and every metric of every clip came back unmeasurable. If the file cannot be parsed, the app refuses to upload rather than guessing.

## 5. On-device AI: the pose guide

## 5. On-device AI: the pose guide

The phone runs MoveNet Lightning to help the operator frame the shot. It is an alignment aid and contributes nothing to any measurement.

| Property | Value |
| --- | --- |
| Model | MoveNet SinglePose Lightning, float16 |
| Size | 4.7 MB, shipped in the app bundle |
| Input | 192 × 192 RGB, uint8 |
| Output | 17 keypoints, each (y, x, score) normalised to the input |
| Runtime | TensorFlow Lite via react-native-fast-tflite |
| Frame source | Camera frame output, GPU-resized with letterboxing |

### Why it is kept separate from the measurement

MoveNet gives 17 COCO keypoints. The server's model gives 33 landmarks including heels and foot index, which several metrics need. The two models disagree slightly on joint centres, so mixing them would introduce a bias that nothing in the record would explain. The on-device model therefore drives the guidance and nothing else, and the interface calls it a "pose guide", never tracking or measurement.

### Presence test

MoveNet returns 17 keypoints for *any* image, including an empty desk, with low scores. Drawing everything above the draw threshold produced a skeleton over a keyboard. A skeleton is drawn only when the frame looks like a person:

| Check | Front and back views | Side views |
| --- | --- | --- |
| Confident keypoints (score ≥ 0.4) | at least 8 of 17 | at least 6 of 17 |
| Torso | 3 of 4 shoulders and hips | one shoulder and one hip |

Side views need their own rule because the far shoulder and hip are hidden behind the body and always score low. Requiring three of four torso points meant a person standing sideways was never detected at all.

### Alignment checks

The guidance runs at about 10 Hz on the JS thread, not in the frame worklet. Each check is deliberately stricter than the server's equivalent, so passing on screen implies passing on the server:

| Check | Threshold | Server rule it protects |
| --- | --- | --- |
| Head not cut off | nose and ears below y = 0.05 | landmarks must sit inside 2–98% of the frame |
| Feet not cut off | ankles above y = 0.90 | heels sit about 0.06 lower, so they stay under 0.96 |
| Horizontal margin | x within 0.05–0.95 | same 2–98% rule |
| Keypoint confidence | ≥ 0.45 | visibility ≥ 0.5 server-side |
| Distance | head-to-ankle span 0.55–0.78 of frame height | keeps the whole body inside the safe box |
| Centred | hip midpoint within 8% of centre | framing |
| Left–right tilt | ≤ 3° | roll is corrected server-side, so a small roll is harmless |
| Forward–back tilt | ≤ 5° | the server rejects above 12° |

The margins exist because a person who only just passes on screen will drift during a 30-second hold.

## 6. Server-side AI: pose estimation

## 6. Server-side AI: pose estimation

The measurement comes from MediaPipe Pose Landmarker running over every frame of the uploaded clip. This is the only model whose output becomes a number a clinician sees.

| Property | Value |
| --- | --- |
| Model | MediaPipe Pose Landmarker, full variant, float16 |
| Landmarks | 33 per frame, with a visibility score each |
| Running mode | VIDEO, which tracks across frames rather than detecting each in isolation |
| Poses per frame | 1 |
| Decoder | PyAV |
| Coordinates | Landmark x, y scaled to the oriented image in pixels |

A lighter variant of the same model backs a separate per-frame endpoint; clip analysis always uses the full model.

### Decoding and pairing

Decoded frame *i* is paired with sidecar frame *i*, and the sidecar's time for that frame becomes the timestamp handed to the model. VIDEO mode requires strictly increasing timestamps, so a repeated time is nudged forward by a millisecond rather than dropped.

The decoder applies the container's rotation so the array matches the oriented image. Three things are treated as fatal rather than recoverable:

- No video stream.
- A rotation that is not a multiple of 90°.
- A decoded frame size that disagrees with the sidecar.

Any of these raises a decode error and the whole clip is reported unsupported. The alternative — carrying on with coordinates that may be rotated or scaled wrongly — would produce plausible numbers that are silently wrong.

### Frames with no pose

If the model returns no pose for a frame, or returns a landmark count other than 33, that frame keeps `points = None`. Nothing is interpolated or carried forward from a neighbouring frame. The frame simply does not contribute, and the quality gate counts it as unusable.

### Landmarks the metrics use

Of the 33, the static battery uses the nose, both ears, shoulders, hips, knees, ankles and heels. The heels are the reason the on-device guide cannot stand in for this model: MoveNet has no heel keypoint, and several metrics plus the body-height scale depend on it.

### Observed throughput

On the current host, a 450-frame clip analyses in about 24 seconds, roughly 19 frames per second. VIDEO mode is sequential within a clip, so extra cores do not speed up a single clip; they let more clips run at once. With concurrency at four, a four-view session analyses in roughly one pass rather than two.

## 7. Quality gating

## 7. Quality gating

A clip is measured only from frames that pass every check. When too few frames pass, the clip returns reason codes instead of numbers. This is the part of the system that most often decides whether a session yields a result at all.

### The reason vocabulary

Twelve codes, shared by the schema, the ML service and the app:

| Code | Meaning |
| --- | --- |
| `insufficient_landmarks` | No pose was detected in the frame. |
| `out_of_frame` | A required body part is cut off. |
| `occlusion` | A required landmark is present but below the visibility threshold. |
| `wrong_view` | The body is not facing the way the step requires. |
| `camera_not_level` | Device tilt exceeds the step's tolerance. |
| `subject_moving` | The person shifted too much during the hold. |
| `insufficient_frames` | Too few usable frames remained. |
| `insufficient_frame_rate` | The measured frame rate was below the step's minimum. |
| `insufficient_scale` | Body height in pixels could not be established. |
| `low_confidence` | Landmark confidence too low to rely on. |
| `identity_uncertain` | The tracked subject may not be the same person throughout. |
| `anchor_drift` | The reference anchor moved during the hold. |

### Per-frame checks

The first second of every clip is skipped outright, to let the person settle after the countdown. Each remaining frame must satisfy:

- **Inside the frame.** Every required landmark lies within 2% to 98% of the width and height. For front and back views the required set is the nose plus both sides' ear, shoulder, hip, knee, ankle and heel. For side views it is the nose plus the near side's seven.
- **Visible.** Each required landmark has visibility of at least 0.5. A landmark that is in frame but under that threshold raises `occlusion` rather than being quietly used.
- **Correct view.** For a front view the left shoulder must appear to the right of the right shoulder in the image, and the reverse for a back view. For a side view the shoulders must be narrow relative to torso height, and the near side's landmarks must be more visible than the far side's. This catches a person who turned the wrong way.

### Clip-level checks

| Check | Rule |
| --- | --- |
| Usable frames | at least 10, and at least 50% of the hold's frames |
| Camera level | median pitch must not exceed twice the step's tolerance, so 12° for the static battery |
| Frame rate | measured rate must meet the step's minimum, 24 fps for the static battery |
| Scale | a positive median body height in pixels must be derivable |
| Movement | the spread of the roll-corrected hip position must stay within 2% of body height |

When the usable-frame count falls short, the gate reports the dominant per-frame reasons alongside `insufficient_frames`, so the result says *why* the frames failed rather than only that they did.

### The rule behind all of it

A quality failure never degrades into an approximate number. The result becomes `unsupported` with its reasons, and any corrective cue is suppressed. A clinician reading "Not measured — out\_of\_frame" knows exactly what to change; a clinician reading a quietly wrong angle does not.

## 8. Mathematics I: coordinate frames and trigonometry

## 8. Mathematics I: coordinate frames and trigonometry

Every angle in the system is measured against true vertical, recovered from the phone's gravity vector, not against the edges of the image. An image tilted by 3° would otherwise add 3° to every postural angle in it.

### The camera frame

The sidecar reports gravity as a unit vector in the oriented image's camera frame:

- **x** points to image right
- **y** points to image down
- **z** points along the optical axis, away from the camera

A level phone filming upright reports approximately \[0, 1, 0\]: gravity pulls straight down the image.

### From the device sensor to that frame

The device reports acceleration including gravity, and linear acceleration separately. Subtracting the second from the first leaves gravity alone, so a moving phone still reports which way is down. iOS device axes in portrait are x right, y up, z out of the screen toward the viewer, so image-down is −y and the rear camera's axis is −z:

```latex
\mathbf{g}_{\text{camera}} = \frac{1}{\lVert \mathbf{g} \rVert}\left(g_x,\; -g_y,\; -g_z\right), \qquad \mathbf{g} = \mathbf{a}_{\text{incl. gravity}} - \mathbf{a}_{\text{linear}}
```

### Roll: the rotation that levels a frame

Roll is rotation about the optical axis. It is fully recoverable from a single 2D image, because gravity's in-plane component tells you which way down is:

```latex
\varphi = \operatorname{atan2}(g_x,\; g_y)
```

Writing gravity's in-plane part as (sin φ, cos φ), rotating by φ maps it to (0, 1) — straight down. Every landmark in the frame is rotated about the image centre by that angle:

```latex
\begin{bmatrix} x' \\ y' \end{bmatrix} = \begin{bmatrix} \cos\varphi & -\sin\varphi \\ \sin\varphi & \cos\varphi \end{bmatrix} \begin{bmatrix} x - c_x \\ y - c_y \end{bmatrix} + \begin{bmatrix} c_x \\ c_y \end{bmatrix}
```

This happens per frame, before any metric is computed, so each frame is levelled using its own gravity reading rather than an average.

When the phone is nearly flat, gravity lies along the optical axis and has no meaningful in-plane direction. The implementation returns a rotation of zero rather than amplifying noise.

### Pitch: measured, never corrected

Pitch is tilt toward or away from the subject. It **cannot** be undone from a single 2D image: tilting the camera back foreshortens the body non-uniformly, and no 2D rotation recovers that. So pitch is only measured, and used to reject:

```latex
\theta = \arcsin\!\left(\frac{\lvert g_z \rvert}{\lVert \mathbf{g} \rVert}\right)
```

A degenerate gravity vector returns 90°, so it can never accidentally pass a level check. The clip is rejected when the median pitch exceeds twice the step's tolerance — 12° for the static battery.

This asymmetry explains the app's two tilt limits: left–right tilt is tolerated to 3° because it is corrected, while forward–back tilt is held to 5° because it is not.

## 9. Mathematics II: the metric formulas

## 9. Mathematics II: the metric formulas

Thirteen metrics, computed per frame on roll-corrected landmarks. Six come from the front and back views, seven from the side views. All are computed in the image plane, which is what `measurementMethod: mediapipe_2d_image_plane` records.

### Front and back views

**Line tilts** — head (ears), shoulders and hips each reduce to the angle of a line between two landmarks, measured from horizontal:

```latex
\alpha = \operatorname{atan2}\!\left(y_{\text{left}} - y_{\text{right}},\; \lvert x_{\text{left}} - x_{\text{right}} \rvert\right)
```

Taking the absolute value on the horizontal term keeps the sign meaning the same whether the person faces the camera or away. Positive means the person's left side sits lower.

**Trunk lateral lean** — the sideways angle of the line from hip midpoint to shoulder midpoint, away from vertical:

```latex
\beta = \operatorname{atan2}\!\left(\Delta x \cdot s_{\text{lat}},\; \Delta y_{\text{up}}\right)
```

`s_lat` is +1 or −1 depending on whether the view is anterior or posterior, so a lean toward the person's left reads the same from both sides.

**Lateral body shift** — horizontal offset between shoulder midpoint and ankle midpoint, expressed as a percentage of body height rather than an angle.

**Knee frontal alignment** — the perpendicular distance from the knee to the hip-to-ankle line, signed by whether the knee falls inside or outside that line. Computed per leg.

### Side views

**Plumb offsets** — for ear, shoulder, hip and knee, the horizontal distance from that landmark to the ankle, as a percentage of body height:

```latex
\text{offset}_{\%} = \frac{(x_{\text{part}} - x_{\text{ankle}}) \cdot s_{\text{fwd}}}{h_{\text{body}}} \times 100
```

`s_fwd` normalises direction so that positive always means forward, whether the left or right side faces the camera.

**Head–shoulder angle** — the angle of the ear-to-shoulder line from horizontal, which is the construction behind forward head posture:

```latex
\gamma = \operatorname{atan2}\!\left(\Delta y_{\text{up}},\; \Delta x_{\text{fwd}}\right)
```

**Trunk inclination** — forward lean of the hip-to-shoulder line from vertical. Note the arguments are the other way round from the head angle, because one is measured from horizontal and the other from vertical:

```latex
\delta = \operatorname{atan2}\!\left(\Delta x_{\text{fwd}},\; \Delta y_{\text{up}}\right)
```

**Knee extension** — the same perpendicular-distance construction as the frontal alignment, but signed fore-and-aft: a knee behind the hip-to-ankle line reads positive, meaning extended beyond straight.

### Guards

Every formula can refuse. If the two landmarks coincide, or the "up" component is zero or negative — meaning the hips sit above the shoulders, so the person is not standing as the step assumes — the function returns nothing for that frame. The frame contributes no value rather than a nonsense one.

### Scale

Offsets expressed as percentages need a body height in pixels, taken as the median over usable frames. If no positive body height can be derived, the clip returns `insufficient_scale`. The system has no metric distance: it cannot say "4 cm forward", only "8% of body height forward".

## 10. Mathematics III: uncertainty

## 10. Mathematics III: uncertainty

Every published value carries an uncertainty in the same unit, and the schema makes it mandatory. The uncertainty combines two independent sources: how precisely the model located the landmarks, and how much the value moved across the hold.

### Per-landmark position uncertainty

Each landmark gets a position standard deviation in pixels, scaled to the person's size and inflated when the model is less confident:

```latex
\sigma_{\text{landmark}} = \frac{f \cdot h_{\text{body}}}{\max(v,\; v_{\min})}
```

where *v* is the landmark's visibility score and the denominator is floored so a near-zero visibility cannot send the uncertainty to infinity. Scaling by body height means the same posture measured at two distances gets comparable uncertainty.

### Propagating to an angle

For an angle built from two landmarks, the two position errors combine in quadrature and divide by the length of the line between them:

```latex
\sigma_{\text{angle}} = \frac{\sqrt{\sigma_a^2 + \sigma_b^2}}{L}
```

This is the small-angle approximation of how a perpendicular wobble at each endpoint turns into an angular error. It carries the geometric intuition that matters clinically: **a short line is a noisy angle**. The ear-to-shoulder line is short, which is why head angles come back with much larger uncertainty than shoulder tilt.

### Combining frames

The reported value is the median across usable frames, not the mean, so one badly-detected frame cannot drag the result:

```latex
\text{value} = \operatorname{median}(x_i)
```

The uncertainty combines the typical per-frame model error with the observed spread, again in quadrature:

```latex
\sigma = \sqrt{\underbrace{\frac{1}{n}\sum_i \sigma_i^2}_{\text{model}} + \underbrace{\left(1.4826 \cdot \operatorname{MAD}\right)^2}_{\text{spread}}}
```

The 1.4826 factor converts a median absolute deviation into the equivalent standard deviation for normally distributed data. MAD is used rather than the standard deviation because it is robust: a handful of outlier frames barely move it.

The two terms answer different questions. The model term asks how well the landmarks were located. The spread term asks whether the person actually held still. A person who swayed gets a large uncertainty even when every individual frame was detected perfectly — which is the honest answer.

### How this is used

Results are shown as value ± uncertainty, never a bare number. When two scans of the same person are compared, the difference is judged against the combined uncertainty of both:

```latex
\lvert A - B \rvert \le \sqrt{\sigma_A^2 + \sigma_B^2}
```

If it falls inside, the app says the difference is within the combined uncertainty. It does not say "improved", "worsened" or "stable" — that reading belongs to the clinician, and with two scans the deviation is only indicative anyway.

In practice the uncertainties observed so far run from about ±1.5° for trunk lean to ±10° for head lateral tilt. Section 15 returns to what that means for clinical usefulness.

## 11. Clinical scope and posturology

## 11. Clinical scope and posturology

The system estimates **visible geometry**. It does not measure spinal curvature, tissue loading, pain, muscle fatigue or injury risk, and no video-inferred number is allowed to stand in for a physiological measurement.

### The catalogue

| Metric | Tier | Unit | What it describes |
| --- | --- | --- | --- |
| Head lateral tilt | estimate | deg | Angle of the line between the ears from horizontal |
| Shoulder line tilt | proxy | deg | Angle of the line between the shoulder landmarks |
| Hip line tilt | proxy | deg | Angle of the line between the hip landmarks |
| Trunk lateral lean | estimate | deg | Sideways lean of hip midpoint to shoulder midpoint |
| Lateral body shift | estimate | % stature | Horizontal offset, shoulders to ankles |
| Knee frontal alignment | proxy | deg | Knee deviation from the hip-to-ankle line |
| Ear / shoulder / hip / knee offset | estimate | % stature | Horizontal distance from the ankle, side view |
| Head–shoulder angle | proxy | deg | Angle of the ear-to-shoulder line from horizontal |
| Trunk inclination | estimate | deg | Forward lean of hip to shoulder from vertical |
| Knee extension | estimate | deg | Knee fore–aft deviation from the hip-to-ankle line |

### Why some are proxies

The tier is not a quality rating. It records whether the number *is* the thing it appears to name.

**Shoulder line tilt** is a proxy because the landmark is not the acromion. MediaPipe's shoulder point sits at an estimated joint centre inside the soft tissue, so the line between them is not the clinical shoulder line — it tracks it. The same applies to the hip landmarks, which are not the ASIS, so hip line tilt cannot be read as pelvic obliquity.

**Head–shoulder angle** is a proxy for the craniovertebral angle. The true construct uses the tragus and the C7 spinous process; this uses the ear landmark and the shoulder landmark, which are nearby but not the same points. Treating one as the other would import published reference ranges that do not apply.

**Knee frontal alignment** is a proxy for the Q-angle and varus/valgus assessment, which are defined on bony landmarks and, properly, on weight-bearing radiographs.

The practical consequence: a proxy number can be tracked within one patient over time, where the same landmark definition applies to both scans, but it must not be compared against a published normal range defined on different anatomy.

### What is not measurable at all

Sagittal spinal curvature, rotation about the body's long axis, leg length difference and anything requiring absolute distance are not derivable from a single 2D camera with no scale reference. Where such a metric is requested, the result is `notMeasurable` with a statement of what would be needed — not an estimate with a wide error bar.

### The claims ladder

The project works to a five-level ladder, where each level needs its own evidence:

| Level | Claim | Status here |
| --- | --- | --- |
| A | Technical measurement with uncertainty | The target. Not yet evidenced by a validation study. |
| B | Task-level assessment | Not built |
| C | Ergonomic exposure | Deferred |
| D | Therapeutic safety or effectiveness | Deferred, needs its own study |
| E | Disease detection or prevention | Out of scope, separate regulatory track |

Nothing in the system claims above Level A, and Level A itself is not yet earned: passing software tests does not authorise a clinical claim. All protocols carry `status: draft` and `clinicallyValidated: false`.

There is no composite posture score anywhere, by policy. An unvalidated 0–100 number implied to correlate with health outcomes is exactly the kind of claim the boundary forbids, so the product shows the angles and lets the clinician read them.

## 12. Safety model

## 12. Safety model

A session is an explicit state machine, implemented in XState so the rules are a property of the graph rather than of whoever wrote the handler. The governing rule: **a safety event outranks any model output.**

### States

`Setup` → `Observing` → `CueEligible`, with `Pause` and `Unavailable` as the two states a session can be pulled into from anywhere.

| From | Event | To |
| --- | --- | --- |
| Setup | `CALIBRATED` | Observing |
| Setup | `SETUP_UNAVAILABLE` | Unavailable |
| Observing | `SUSTAINED_DEVIATION` | CueEligible |
| CueEligible | `CUE_DELIVERED` | Observing |
| Observing, CueEligible | `QUALITY_LOST` | Unavailable |
| **any non-terminal state** | `SYMPTOM_REPORTED` | **Pause** |
| **any non-terminal state** | `CONTRAINDICATION_FLAGGED` | **Pause** |

The last two rows are defined once, at the machine level, rather than repeated per state. That is deliberate: it makes "every symptom report lands in Pause" structurally true, so a new state added later inherits it and cannot accidentally omit it.

### Why Pause has no automatic exit

Neither `Pause` nor `Unavailable` has a transition back out that any model output can trigger. Confidence rising again does not resume a session. Escalation is a distinct second step taken *from* Pause, never a way to skip it, and the service sends it only after the symptom report itself has been recorded.

This is the concrete expression of the precedence rule. A model that is highly confident the movement is fine has no path to overrule a reported symptom.

### Upload guard

Clip upload consults the session's safety state before accepting anything. A paused session does not take new clips, so a session cannot keep collecting data after a symptom was reported.

## 13. Security and privacy

## 13. Security and privacy

Identity is separated from measurement data. The patient register holds names; everything downstream holds only a pseudonymous subject id.

### Identity separation

| Record | Holds |
| --- | --- |
| `Patient` | Encrypted name, date of birth. The only place identity lives. |
| `PatientSubjectLink` | Maps a patient to a pseudonymous subject id. |
| `Session`, `Clip`, `Event`, `ConsentRecord` | The subject id only, never a name. |

Patient names are encrypted at rest under a key held outside the database, supplied as `PATIENT_DATA_KEY` (32 random bytes, base64). The key must be backed up separately from the database: without it the register cannot be read, and a database restore alone will not recover it. This was verified during the host migration — names decrypted correctly on the new host only because the key moved with them.

### Authentication

- Clinician passwords are hashed with bcrypt.
- A clinician JWT authorises the workflow; the device stores it in the iOS Keychain via secure storage.
- Clip upload uses a separate session-scoped token, and the guard rejects a clinician token with 403.
- The app locks after 10 minutes idle, checked both on a timer and when the app returns to the foreground, so backgrounding past the threshold locks on reopen.
- There is no self-service signup. Accounts are provisioned by a seed script with a minimum password length of 12.

### Consent

A session cannot be created without a consent record, and the session carries its id. The consent text shown to patients is clinically reviewed and is not edited without review. It states four things: short video clips of four standing poses are recorded and uploaded to the clinic's server; video is not retained after measurement; measurements are camera-based estimates reviewed by a clinician and are not a substitute for clinical examination; and the recording can be stopped at any time.

### Clip retention

The second of those is enforced in code: after analysis, the job runner deletes the clip file unless the session's consent explicitly includes a scope that keeps it. Deletion also runs on the failure path, so a clip is not left behind by a crashed job. Only the derived measurements and the sidecar persist.

### Known gaps

- The patient signature captured on the consent screen is **not** stored on the server. The consent record has no signature field, and the app says so under the pad.
- The consent record carries no clinician attribution, so it cannot currently answer "who took this consent".
- Transport is TLS 1.2+ via Let's Encrypt; the ML service is unreachable from outside the Docker network.

## 14. Deployment and operations

## 14. Deployment and operations

The stack runs as three Docker containers behind the host's own nginx, on a server shared with unrelated projects. The mobile app reaches it at a hostname, not an IP, so the backend can move without rebuilding or resubmitting the app.

### Host and allocation

The stack moved to a 16-core / 31 GB host on 3 November 2026. Limits reserve 10 cores and 12 GB, leaving the rest for the other projects on the box:

| Service | CPU | Memory |
| --- | --- | --- |
| ml-service | 6 | 8 GB |
| backend-api | 2 | 2 GB |
| postgres | 2 | 2 GB |

The ML service gets the largest share because clip analysis is the only CPU-bound step. Analysis concurrency is 4, so a four-view session analyses in one pass.

### Request path

Host nginx terminates TLS and proxies to the backend on `127.0.0.1:3100`. Nothing else is published; the ML service and database are reachable only inside the Docker network. Relevant settings: a 100 MB body limit (a 30-second clip is about 22 MB), a 300-second read timeout, and request rate limiting at 20 requests per second with a burst of 60.

### Throughput

A 450-frame clip analyses in about 24 seconds, roughly 19 frames per second. Because VIDEO-mode inference is sequential within a clip, more cores do not make one clip faster — they let more clips run at once.

### Migration pattern

The move to the current host is worth recording, because it is the pattern to reuse. The new host was built and fully verified before any DNS change, then the **old host was pointed at the new one** so that both IPs served one database during propagation. That removes the split-brain window entirely: with a 4-hour DNS TTL, a plain switch would have left some devices writing to a stale database for hours. The old stack was then stopped with its volumes intact as a rollback point.

The existing TLS certificate was copied to the new host rather than reissued, so there was no gap in HTTPS during the cutover.

### What is not in place

There is no crash reporting, no application metrics and no verified backup schedule. Operational visibility today is container logs and direct database queries.

## 15. Known limitations

## 15. Known limitations

Stated plainly, because each one bounds what the output can be used for.

### Measurement validity

- **Nothing is clinically validated.** All protocols carry `status: draft` and `clinicallyValidated: false`. No validation study has been run.
- **No reference ranges are loaded.** The schema supports them, but no validated set exists, so results show the measured angle with no "within range" judgement. A report is a measurement sheet, not an assessment.
- **Uncertainty may exceed the effect of interest.** Observed figures run from about ±1.5° for trunk lean to ±10° for head lateral tilt. Postural changes clinicians track are often smaller, so two scans of the same person can differ by more than the thing being tracked. The compare view says so rather than implying a trend.
- **Quality thresholds were never calibrated on this hardware.** They were chosen against server-side output and have not been validated on an iPad camera across a device matrix.

### Capture

- **Demanding conditions.** The whole body including heels must be in frame, the device upright and still, and the person steady for 30 seconds. That needs roughly 2.5–3.5 m of clear space and a stand. Handheld capture does not reliably pass the gate.
- **One person only.** Both models track a single person. A clinician stepping into frame can cause the server model to lock onto the wrong body, and nothing in the record would reveal it.
- **Clothing and lighting** affect landmark visibility; loose clothing degrades hip and knee landmarks in particular.
- **No recovery from a dropped upload.** A network failure mid-upload loses the clip and the pose must be repeated.

### Platform

- Capture-quality statistics are held in memory only and are lost if the app restarts.
- The patient lookup for repeat scans issues one request per patient and caps at 100, so it degrades as the register grows.
- Only iPad has been tested. The iPhone layout is untested.
- Haptic feedback is silent on iPad, which has no Taptic Engine. The visual and on-screen cues carry it there.

### Open questions worth settling

1. Which reference ranges, if any, can be defended for proxy metrics measured on MediaPipe landmarks rather than bony anatomy.
2. Whether a 30-second hold is the right trade between frame count and what patients can actually sustain.
3. Whether signature and clinician attribution on the consent record are needed before clinical use.
