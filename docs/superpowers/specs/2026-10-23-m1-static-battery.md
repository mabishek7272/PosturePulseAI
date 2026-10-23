# M1 — Static battery end to end (spec)

Parent plan: `~/.claude/plans/peppy-baking-pearl.md` (approved). Contracts: `packages/schemas/src/{clip-capture,
metric-result,reference-range-set,assessment-battery,assessment-report}.schema.json`; data:
`references/assessment-battery.v0-draft.json`, `references/posture-reference.v0-draft.json`.

Rules that every slice must keep (CLAUDE.md): no diagnosis or condition names in any product text; no composite
score; never fabricate a value (emit `unsupported` / `notMeasurable` instead); symptom reports always pause; every
record carries provenance; schemas are edited only in `packages/schemas/src` (none are expected to change in M1).

## Flow
Patient or clinician opens a session (existing consent + session token, ADR-012) → app fetches the battery →
for each static step: on-device guidance (Vision 2D ~10 fps, level from CoreMotion) → record a 30 fps HEVC clip
with a per-frame sidecar → upload → backend queues an analysis job → ml-service analyses the clip → metric results
appended to the event log → app shows the step's quality outcome (Redo if unsupported) → clinician builds the
draft report, reviews, signs off → patient opens the released report.

## Slice A — ml-service (Python)
- `POST /internal/clips/analyze` request
  `{sessionId, clipId, stepId, clipPath, sidecar: ClipCapture, metricKeys: string[], minFps, levelToleranceDegrees}`;
  `clipPath` is a file on the shared volume `CLIP_DIR` (default `/data/clips`). Response
  `{results: MetricResult[], landmarkSeries: {path, sha256}, frameQuality: {usable, total, reasons: string[]}}`.
  Every requested metricKey yields exactly one MetricResult (estimate or unsupported). Never raises for bad video
  content: decode failure → every result unsupported with reason `insufficient_frames`.
- `GET /internal/metrics/catalog` → `{metricsVersion, metrics: [{metricKey, label, module, tier, unit, side,
  signConvention, description}], notMeasurable: [{metricKey, label, reason, whatWouldBeNeeded}]}`.
- Pipeline: PyAV decode → MediaPipe PoseLandmarker **full** model, **VIDEO** mode with sidecar timestamps
  (ms) → pixel coordinates (x·width, y·height) → per-frame roll correction: rotate points so the sidecar gravity's
  image-plane component points straight down (+y) → quality → metrics → store the landmark series as gzip JSON in
  `CLIP_DIR/landmarks/<clipId>.json.gz` with sha256.
- Quality (frame-level, then step-level): required landmarks visibility ≥ 0.5 and inside the frame (2% margin)
  else frame unusable (`out_of_frame`/`occlusion`); pitch `asin(|g_z|)` > 2× levelTolerance → `camera_not_level`
  for the whole clip (roll is corrected, pitch cannot be in 2D); view check per frame (anterior: person-left
  shoulder at larger image x than person-right; posterior: the reverse; lateral: shoulder width < 35% of
  shoulder-to-hip height and the named side nearer the camera by visibility) else `wrong_view`; skip the first
  1.0 s of a hold; usable frames < max(10, 50% of expected) → `insufficient_frames`; measured fps < minFps →
  `insufficient_frame_rate`; hip-midpoint SD > 2% of body height → `subject_moving`.
- Body height `H` = vertical (gravity-aligned) distance from nose to heel midpoint (lateral: same-side heel), in
  pixels, median over usable frames. Unit `percent_stature` means percent of `H` (say so in each description).
- Estimate = median over usable frames. Uncertainty (draft model, documented in code): per-landmark position SD
  `σp = 0.01·H / max(visibility, 0.5)`; angle SD from segment length `σθ ≈ √2·σp / L` (radians → deg); combined with
  between-frame spread `1.4826·MAD` as `√(σ_model² + σ_spread²)`.
- Static metrics (signed; person-left/right from MediaPipe labels; `s_lat` = +1 anterior, −1 posterior;
  `s_fwd` = sign(nose_x − ear_x) on the lateral view's near side):

  | metricKey | views | tier | definition | sign |
  |---|---|---|---|---|
  | static.head_lateral_tilt | ant, post | estimate | atan2(y_Lear − y_Rear, abs(x_Lear − x_Rear)) | + = left side lower |
  | static.shoulder_line_tilt | ant, post | proxy | same with shoulders | + = left side lower |
  | static.hip_line_tilt | ant, post | proxy | same with hips | + = left side lower |
  | static.trunk_lateral_lean | ant, post | estimate | angle of hip-mid→shoulder-mid from vertical, lateral component × s_lat | + = toward person's left |
  | static.lateral_body_shift | ant | estimate | (x_shoulderMid − x_ankleMid)·s_lat / H · 100 | + = toward person's left |
  | static.knee_frontal_alignment | ant | proxy, side=left/right (two results) | 180° − ∠(hip,knee,ankle); signed by knee offset from the hip–ankle line toward the hips' midpoint | + = knee toward midline |
  | static.plumb_offset_{ear,shoulder,hip,knee} | lat | estimate | (x_landmark − x_ankle)·s_fwd / H · 100, near side | + = anterior |
  | static.head_shoulder_angle | lat | proxy | angle of shoulder→ear line above horizontal | larger = head more upright over shoulder |
  | static.trunk_inclination | lat | estimate | hip→shoulder line from vertical, ·s_fwd | + = forward |
  | static.knee_extension | lat | estimate | 180° − ∠(hip,knee,ankle), + when knee is posterior to the hip–ankle line | + = extended beyond straight |

- Standing not-measurable list (catalog `notMeasurable`): Q-angle; craniovertebral angle (needs a C7 marker);
  forward shoulder angle (needs C7); anterior pelvic tilt (needs ASIS/PSIS); kyphosis/lordosis/scoliosis curvature;
  pronation/supination; weight distribution; ground reaction force; joint moments; muscle activity (EMG).
- Docker: add `av` dependency; `scripts/fetch-pose-model.sh` also fetches `pose_landmarker_full.task`; config
  `POSE_LANDMARKER_FULL_MODEL_PATH`. Provenance `modelVersion` = `mediapipe-pose-full/<mediapipe version>`,
  `metricsVersion` = `metrics/v1`, `clipSha256` from the clip file.
- Tests (pytest, synthetic): build landmark sequences programmatically (no video) for each metric with known
  answers; rolled-gravity test (5° roll gives the same corrected shoulder tilt); cropped feet → `out_of_frame`;
  wrong view → `wrong_view`; pitch → `camera_not_level`; every requested key returns exactly one result that
  validates against metric-result.schema.json; plus one end-to-end test that encodes a short synthetic video with
  PyAV (no person) and gets all-unsupported results.

## Slice B — backend-api (NestJS/Prisma)
- Prisma: `Clip{id, sessionId, stepId, path, sha256, sidecar Json, status uploaded|analyzed|failed|discarded,
  createdAt}`, `AnalysisJob{id, clipId unique, status pending|running|done|failed, attempts, lastError, lockedAt,
  createdAt}`, `AssessmentReport{id, sessionId, reportVersion, status, body Json, signedBy, signedAt, contentSha256,
  createdAt}`, `Patient{id, nameEnc, dobEnc, contactEnc, createdBy, createdAt}`,
  `PatientSubjectLink{patientId, subjectPseudoId unique}`. Migration added under `prisma/migrations`.
- `GET /assessment-battery` (public) → the battery JSON, validated at startup.
- `PUT /sessions/:id/clips/:stepId` (JwtAuthGuard + SessionOwnershipGuard), multipart: `clip` (video/mp4 or
  quicktime, ≤100 MB) + `sidecar` (JSON, validated against clip-capture, sessionId/stepId must match the route).
  409 when the session's safety state is Pause, Unavailable or ClinicianReview. Saves to `CLIP_DIR/<clipId>.mov`,
  sha256, creates Clip + AnalysisJob. Re-upload of the same step creates a new clip; the newest analysed clip per
  step wins. Response `{clipId, status}`.
- `GET /sessions/:id/steps` (subject token) → per step `{stepId, status: missing|processing|analyzed|failed,
  usable, reasons[]}`.
- Job runner (in-process, `ANALYSIS_CONCURRENCY` default 2, poll 1 s): claim with
  `UPDATE ... WHERE id = (SELECT id ... FOR UPDATE SKIP LOCKED LIMIT 1)`; call ml-service analyze; append each
  result with `EventsService.appendValidated(sessionId, "metric-result", r)`; mark done; delete the clip file unless
  the session's consent has `raw_video`; retry up to 3 times then failed. Register the five new schemas in
  `common/schema-registry.ts`. These modules never import SafetyService except to read state for the 409.
- Report builder (pure function + jest table tests): inputs = latest result per (metricKey, side, stepId) +
  reference set + ml catalog. Position: estimate interval [v−u, v+u] entirely below/above the reference
  (value or [min,max]) → below/above; overlapping a bound → indeterminate; inside → within; no reference →
  no_reference; no estimate → not_applicable. Proxy rows may only use `geometric` references (reject a literature
  reference for a proxy at load time). Fixed templates by (position, tier), filled only with the row's own numbers,
  e.g. within: "{value}{unit} ± {u}{unit}; within the {ref} reference.", above: "{value}{unit} ± {u}{unit};
  above the {ref} reference by about {d}{unit}.", indeterminate: "... the uncertainty overlaps the {ref}
  reference.", no_reference: "{value}{unit} ± {u}{unit}. No reference value is set for this measurement.",
  unsupported: "Not measured: {reasons in plain words}.". A jest test renders every template and fails on any
  phrase in `references/banned-phrases.json` (create it: condition names, normal/abnormal, risk, score,
  optimal/excellent/perfect/textbook, poor/bad/good posture, "indicates", "diagnos").
- Clinician routes (JwtAuthGuard + RolesGuard clinician + AuditAction): `POST /sessions/:id/report` (build draft
  vN+1), `GET /reports?status=draft|released`, `GET /reports/:id`, `POST /reports/:id/rows/exclude
  {metricKey, side, stepId, reason}`, `POST /reports/:id/assessment {text}`, `POST /reports/:id/sign-off
  {password}` (re-verifies the clinician's password, computes sha256 over the canonical JSON body, status
  released), `POST /reports/:id/reject {reason}`. Each mutation of a draft is allowed only while draft.
- Patient access: `POST /sessions/:id/report-access` (subject session token) → `{reportAccessToken}` (JWT
  `{role: "report_reader", sessionId, sub}`, 180 days). `GET /sessions/:id/released-report`
  (Bearer report-access token or subject token for that session) → latest released report or 404
  `{status: "pending_review"}`.
- Patient register (ADR-017): AES-256-GCM per field with `PATIENT_DATA_KEY` (32-byte base64, required; refuse to
  start the register module without it); clinician-only + audited: `POST /patients {name, dateOfBirth, contact?}`,
  `GET /patients?q=` (decrypt then filter, max 200), `POST /patients/:id/link {subjectPseudoId}`,
  `GET /patients/:id/sessions`. Identifiers never enter the event log or canonical records.
- Infra: compose volume `clipdata` mounted at `/data/clips` in backend-api and ml-service; env
  `CLIP_DIR`, `ANALYSIS_CONCURRENCY`, `PATIENT_DATA_KEY`; backend Dockerfile copies `references/`.
- ADR-013 (clip-based analysis; backend job runner over Postgres SKIP LOCKED; supersedes per-frame streaming for
  assessments; amends ADR-003), ADR-015 (tiers, positions, reference kinds, templates), ADR-017 (patient register)
  and the `docs/consent-and-retention.md` "Subject identity" update.

## Slice C — iOS (SwiftUI)
- `BatteryClient`: `GET /assessment-battery`; `ClipUploadClient`: multipart PUT with session token, persisted retry
  queue (files in Application Support with `NSFileProtectionComplete`), deletes the local clip after 2xx;
  `StepStatusClient`: `GET /sessions/:id/steps`.
- `ClipRecorder`: AVCaptureSession back wide 1×, 1080p 30 fps (`minFps` floor), video stabilization off, HEVC via
  AVAssetWriter; per-frame sidecar entry `{index, t, gravity}` from CMDeviceMotion. Gravity conversion for a
  portrait-oriented clip from the back camera: device gravity `(gx, gy, gz)` → camera frame `(gx, −gy, −gz)`
  (unit-normalised); landscape orientations handled in the same function with tests.
- `GuidanceEngine`: Vision `VNDetectHumanBodyPoseRequest` on every 3rd frame → full body visible, view matches the
  step (same rules as slice A, 2D), stillness; drives `GuidedCaptureView` (data-driven steps from the battery,
  filtered by mode). Recording starts automatically after 1.5 s of level + framed + still; never shows a measured
  number. Patient mode speaks the instruction with AVSpeechSynthesizer.
- `BatteryRunner` (replaces SessionViewModel for assessments): steps → record → upload → poll status → show
  "Looks good" or the reasons with Redo. SymptomStopButton stays visible on every step (local-first).
- Clinic mode: after sign-in, `PatientPickerView` (search/create via `/patients`, clinician token), then consent,
  battery, then `POST /patients/:id/link`. Patient mode: consent → battery → "Your clinician will review your
  results"; a Results screen fetches `/sessions/:id/released-report` with the stored report-access token
  (obtained right after the battery via `/report-access`, kept in Keychain).
- `AssessmentReportView` maps the assessment-report body: tier chip (Estimate/Proxy), positions incl.
  indeterminate and no_reference (no gauge band when no reference), unsupported rows "Not measured" with reasons,
  standing not-measurable list, clinician's assessment block, Draft badge when the reference set is draft.
- Update `NSCameraUsageDescription` (clips are sent to the clinic server and deleted after analysis unless video
  keeping was chosen). Tests: gravity conversion (portrait/landscape), sidecar JSON matches the schema field names,
  battery decoding of the real JSON file, multipart body builder, report mapping incl. not_applicable/no_reference.

## Slice D — clinician-web (React)
- Pages: `ReviewQueuePage` (`GET /reports?status=draft`, session safety state badge, link), `ReportReviewPage`
  (`GET /reports/:id`: rows table grouped by step with value ± uncertainty, reference + citation, position, tier,
  quality reasons; Exclude with required reason; Clinician's assessment textarea; Sign-off dialog asking for the
  password; Reject with reason; a "Build draft report" button on the session page calls `POST
  /sessions/:id/report`), `PatientRegisterPage` (search, create, view linked sessions).
- No colour coding of positions (colour-neutral), no score, Draft badge on references. Vitest tests for the
  table rendering, exclude requiring a reason, and sign-off submitting the password once.

## Out of M1
Clip/skeleton replay (needs the landmark-series endpoint; M2), cm units/scale, sway, functional/gait/ergonomic
modules, MedBuddy, PDF.
