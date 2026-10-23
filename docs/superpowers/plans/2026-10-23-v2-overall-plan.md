# PosturePulse AI v2 — combined posture, movement, gait & ergonomic assessment

## Context
The current app is a thin scaffold: one exercise list and a basic pose overlay, on a server pipeline that analyses
single JPEGs. That pipeline uses MediaPipe *lite* in IMAGE mode and reads only image-normalised landmarks, never the
world landmarks. It has no gravity reference, discards real frame timestamps, and its scale factor is never applied.
It cannot produce a centimetre plumb line or 60 fps gait. The user wants one app combining:
- biomechanics: coronal, sagittal (Kendall plumb line) and transverse planes; centre of mass vs. base of support;
  joint angles
- clinical/physio metrics
- ergonomics: RULA, REBA, OWAS, NIOSH and workstation metrics
- dynamic movement and gait analysis

**Decisions (user)**
- Results are measurements with uncertainty, cited draft reference ranges and "outside reference range" flags.
  Diagnosis is written only by the reviewing clinician (CLAUDE.md rule 1 unchanged).
- Everything is in one app. Each session starts by choosing **Clinic mode** or **Patient mode**.
- Rebuild the iOS app in this repo and keep the backend core: consent, ADR-012 session tokens, safety state machine,
  event log, audit log and schemas. The measurement pipeline is rewritten.
- Patient identity (name, date of birth) lives **on the server**, in a clinician-only, encrypted register.
- Analysis sentences use fixed, reviewed templates. MedBuddy is a later milestone (more than 25 minutes of work).
- **Host:** new shared server 103.118.158.129 (ssh :18755, user ubuntu), with existing host nginx and certbot and
  many other projects. The old server is gone, so the database starts empty.

**How this design was chosen:** a design panel compared three designs (on-device-first, server-centric,
clinician-workflow). Two independent judges both picked clinician-workflow; it was then merged with the best
runner-up ideas.

**Verified pre-existing safety bug:** `safety-state-machine.ts` has no `SYMPTOM_REPORTED` transition in **Setup** or
**Unavailable**, so a symptom reported in those states is dropped. Fixed first.

## Architecture
- **Device (iPhone/iPad):** Apple Vision 2D runs at ~10 fps **for guidance only**: framing, view check, stillness,
  and a rep/pass counter shown on screen. It never uploads data and never displays a measurement. Each capture step
  records an HEVC clip on the back 1× lens, with stabilisation and Center Stage off.
  - **Frame rate:** 30 fps for static holds, 60 fps for gait and landings.
  - **Sidecar file per clip:** per-frame timestamps, CoreMotion gravity, camera intrinsics, device, fps and app
    version.
  - **Storage and upload:** clips are file-protected, uploaded in the background, and deleted once the server
    acknowledges them.
- **Backend:** `PUT /sessions/:id/clips/:stepId` requires `JwtAuthGuard` + `SessionOwnershipGuard`. It returns 409
  while the session is in Pause, Unavailable or ClinicianReview. Uploads create Clip and AnalysisJob rows; the
  queue is Postgres `FOR UPDATE SKIP LOCKED` (Redis removed).
- **ml-service worker** (`python -m app.jobs.worker`):
  1. Decode with PyAV.
  2. Run the MediaPipe PoseLandmarker **full** model in **VIDEO** mode, keeping image and world landmarks.
  3. Correct for aspect ratio, and rotate to true vertical using the sidecar gravity.
  4. Run the quality gate, then the metric registry, to produce `metric-result` records.
  5. Store the landmark series as one gzip blob (sha256) per clip.
  6. Delete the clip after extraction unless the patient gave `raw_video` consent.
- **Metric code exists once, in Python with pytest.** The registry rejects any metric that lacks a tier, a required
  view or its required landmarks. A new metrics version recomputes from stored landmarks and appends superseding
  records.
- **Safety:** add `SYMPTOM_REPORTED` → Pause and a new `CONTRAINDICATION_FLAGGED` → Pause to every non-terminal
  state. Clip, job and metric modules never import SafetyService (ADR-005). `SymptomStopButton` stays local-first and
  gets a persistent retry queue.
- **Provenance on every record:** schema, model (with model-file sha256), adapter, metrics, calibration and
  reference-file versions, clip sha256, app version, device, fps.

## Session modes
- **Clinic mode:** the clinician signs in (ADR-010 JWT) and picks or creates a patient in the server register.
  Consent is taken on the device. The clinician chooses modules (Static is always included; Functional, Gait and
  Workstation are optional) and works through the contraindication checklist from `protocols/*.json`. Ticking an
  item triggers `CONTRAINDICATION_FLAGGED` → Pause. Then height entry, tripod setup at 3 m with the phone level to
  ±3°, and each step with an on-device check, the server quality result in about 30–60 s, and a Redo button.
- **Patient mode:** self-guided with a propped phone, using voice and on-screen prompts and the same clip pipeline.
  - **Modules:** low-risk only — Static, squat ×5, sit-to-stand ×5, shoulder flexion and walking passes. No drop
    landing, no single-leg tasks, no workstation lift.
  - **Before starting:** the contraindication questions are asked, and any "yes" stops the module.
  - **Results:** shown only after a clinician reviews and releases them remotely. The patient is linked to a
    register entry through a clinic-issued invite code.
- **Capture battery** (definitions in `protocols/*.json` `captureSteps` with view, minFps and metricKeys):
  - **Static:** anterior 15 s (also used for sway), posterior 5 s, left and right lateral 5 s each.
  - **Functional:**
    - squats: ×5 anterior, ×3 lateral
    - single-leg squat: ×3 per side (Clinic mode only)
    - sit-to-stand: ×5
    - shoulder flexion: ×3 per side
    - single-leg stance: 20 s
    - drop landing: optional, Clinic mode only
  - **Gait:** side passes with ×3 in each direction, analysing only the central 3 m; frontal passes walking toward
    and away from the camera.
  - **Workstation:** seated typing and mouse use, an optional lift, and an entry form for screen distance, load,
    coupling and frequency.
  - **Frame-rate floor:** below a step's minimum fps, its event metrics are reported as unsupported.

## Metric catalog (tiers: estimate · proxy · entered · annotated · not measurable; all references draft)
- **Coronal**
  - Estimates: head tilt; shoulder-line and hip-line tilt and height difference (proxies for acromion level and
    pelvic obliquity); knee and ankle level; trunk lean; lateral shift; left–right differences.
  - Proxy: knee frontal-plane alignment (stands in for valgum/varum), with no reference until the clinical lead
    sets one.
- **Sagittal**
  - Kendall plumb-line offsets of the ear, shoulder, hip and knee from true vertical through the ankle, in cm when a
    scale is set.
  - Segment inclinations; knee extension beyond straight; ankle angle.
  - The ear–shoulder angle is a forward-head **proxy** and never uses CVA norms. **True CVA is "annotated"**: the
    clinician taps C7 and the tragus on a keyframe, which needs `raw_video` consent.
- **Transverse:** shoulder and pelvic rotation are **proxies** (world-landmark z), shown to clinicians only; LiDAR
  comes later.
- **Centre of mass vs. base of support:** segmental model (Winter); base of support from the heel and foot-index
  points; quiet-stance sway as RMS, path length and 95% ellipse.
- **Functional:** frontal-plane projection angle (FPPA) per rep (squat, single-leg squat, landing at ≥60 fps);
  single-limb hip-line drop (proxy); squat depth, trunk lean and left–right difference; shoulder flexion with
  compensation; five-times sit-to-stand time.
- **Gait:** initial contact, mid-stance, toe-off and swing (Zeni, ±1 frame); cadence; stance/swing and
  double-support %; step-time asymmetry; step length and speed (need a scale); knee and hip angles at gait events;
  trunk sway and lateral centre-of-mass shift.
- **Workstation and ergonomics**
  - Seated elbow, trunk–thigh and knee angles; neck angle (proxy).
  - Screen distance is *entered* (tape measure); gaze angle is *annotated*.
  - RULA, REBA and OWAS: body-segment items come from the video; force, coupling, activity, twist and load are
    entered.
  - NIOSH: H, V and D are suggested from the video and confirmed by the clinician.
- **Always listed as "Not measurable with this system":** Q-angle, forward shoulder angle (needs C7), anterior
  pelvic tilt (needs ASIS/PSIS), kyphosis/lordosis/scoliosis, pronation/supination, weight distribution, ground
  reaction force, joint moments, EMG.
- **Reference file:** `references/posture-reference.v0-draft.json` records `appliesTo`, `sourceCitation`,
  `status: draft` and `reviewedBy: null` for each entry. Numbers from the `~/posture-service` prototype are kept only
  if they are traceable and their definitions match ours. Its finding wording and score are discarded.

## Report, review, claims
- **Report builder (`ReportBuilder`, deterministic):**
  - Fixed templates.
  - "Outside reference range" appears only when the whole value ± uncertainty interval lies outside the range.
  - The result is "indeterminate" if that interval overlaps a bound.
  - Proxy and not-measurable rows show "no reference".
- **clinician-web review:**
  - Queue with a Pause badge.
  - Skeleton or clip replay with a timeline of reps, gait events and the frames quality-rejected.
  - A metric table whose rows seek to their source frame.
  - Keep or exclude each row; excluding needs a reason.
  - Request recapture.
  - Ergonomic entry form and keyframe annotator.
  - A free-text "Clinician's assessment", the only place diagnostic language may appear.
  - Sign-off requires re-entering the password, freezes a content sha256 and is audited.
  - Amendments create new versions.
- **Released report:** iOS (the existing dark readout, plus a tier chip and the indeterminate state) and a
  server-rendered PDF. Patients open it with a per-report release token.
- **Claims:**
  - Metric names are descriptive only.
  - One shared banned-phrase list is used by `scripts/lint-claims.sh`, the templates and clinician-web, with a
    pytest that renders every template.
  - No composite score and no red/amber/green colouring.
  - **RULA/REBA/OWAS/NIOSH** have their own clinician-only section, hidden from the patient by default. Each shows
    its components and sources, the published action-level wording (quoted and attributed) and a caption: "describes
    the recorded task posture, not the person's health". A missing input gives "Incomplete", never a partial total.
  - `protocols/*.json` status fields stay untouched.

## Patient register (server identity)
- New Prisma models `Patient` (name, date of birth and contact, **field-encrypted** with AES-GCM; key from
  `PATIENT_DATA_KEY` env) and `PatientSubjectLink` (patient → pseudonymous `subjectPseudoId`).
- **Isolation:** clinician-only routes behind `JwtAuthGuard` + `RolesGuard("clinician")` + `@AuditAction`. Canonical
  schemas and the event log stay identifier-free; reports reference the patient only through the link.
- **Documentation:** new ADR-017, plus an update to `docs/consent-and-retention.md` "Subject identity".
- **Precondition for real patients:** disk or database encryption at rest on the host.

## Files
- **Keep (iOS):**
  - `DesignSystem/*`, `Consent/*` (copy updated), `Identity/*`, `Networking/{SessionCredentials, SessionsClient,
    BackendConfig, ProtocolsClient, SessionWebSocketClient}`, `Safety/*`, `HeightEntryView`.
  - `GuidedCaptureView` pieces (StepTrack, LevelIndicator, HoldRing, FramingBrackets) become data-driven.
  - `Report/*` gains tier and indeterminate support.
- **Keep (backend):** `auth`, `consent`, `sessions`, `symptoms`, `events`, `audit`, `ws`, `common/schema-registry`,
  `protocols`.
- **Keep (ml-service):** `pose/landmark_mapper.py`, `quality/*`, `geometry/{scale_calibration, coordinate_frames}`,
  `events/emitter.py`, `versioning.py` (plus METRICS_VERSION and REFERENCE_FILE_VERSION).
- **Rewrite:**
  - `geometry/kinematics.py`: aspect-corrected, gravity-referenced.
  - `geometry/covariance.py`: real uncertainty from confidence and spread within a hold.
  - `pose/mediapipe_adapter.py`: VIDEO mode, full model, world landmarks.
  - `safety-state-machine.ts`.
  - `frames.controller.ts` → `clips.controller.ts`; `ml-result.consumer.ts`; `ml-client.service.ts` → job API.
  - iOS `CameraCaptureController` → clip recorder with sidecar; `SessionViewModel` → BatteryRunner; `RootView`
    (mode chooser → flows); `ProtocolSelectionView` → ModulePicker; `PoseOverlayView` (Vision skeleton, no
    numbers).
- **New:**
  - ml-service: `app/jobs/`, `app/metrics/{registry, static, functional, gait, workstation, ergonomic,
    not_measurable}.py`.
  - Prisma models: Visit, Clip, AnalysisJob, ClinicianInput, ClinicianAnnotation, AssessmentReport, ReleaseToken,
    Patient, PatientSubjectLink.
  - clinician-web: AssessmentReviewPage, ClipReplay, MetricTable, ErgonomicInputsForm, KeyframeAnnotator,
    SignOffDialog, PatientRegister.
  - Infra: `infra/nginx/posture.beaive.com.conf`.
- **Delete or park:**
  - iOS: `FrameStreamingClient`, `CameraPoseStreamingClient`, `ARSessionController`, `TwoDFallbackBanner`.
  - Infra: `infra/Caddyfile` and the caddy and redis services.
  - Runtime image: drop `detection/*`, `movement/*`, `exposure/posture_bucket_classifier.py` and torch.
- **From PostureAIPro:** copy only the Vision joint mapping (`VisionPoseModel.swift`); port the logic of `com.py`
  and `reporting/validator.py`. Don't reuse `BiomechanicsEngine` (it fabricates 0 for unobserved values) or its
  GRDB/FieldCipher store.
- **Schemas** (edit `packages/schemas/src` only, then `schemas:generate` / `schemas:check`):
  - New: `clip-capture`, `metric-result` (exactly one of estimate, unsupported or notMeasurable;
    `tier=not_measurable` forces a null estimate), `assessment-report` (adds position "indeterminate" and
    "no_reference", signOff sha256), `reference-range-set`, `clinician-input`, `clinician-annotation`,
    `ergonomic-assessment`, `assessment-battery`.
  - Extended: `quality-gate-flag` reasons (wrong_view, out_of_frame, camera_not_level, insufficient_frame_rate,
    insufficient_frames, insufficient_strides, subject_moving); common provenance; `protocol-definition`
    captureSteps.
- **ADRs:**
  - 013: clip-based server analysis (amends 003).
  - 014: on-device Vision for guidance only (updates "no on-device inference" statements in the READMEs, SBOM and
    IEC 62304 docs).
  - 015: tiers, reference kinds, indeterminate rule and ergonomic-tool presentation.
  - 016: hosting behind host nginx.
  - 017: server patient register.

## Deployment (shared host — do not disturb other projects)
- **Compose project `posturepulse`:** postgres, backend-api and two ml-workers, all on an internal network.
  - backend-api is published only on `127.0.0.1:3100`.
  - Each worker is limited to 2 CPU / 2 GB; Postgres to 1.5 GB.
  - Ports 3000/5432/6379/8000 are not used on the host.
- **nginx site `posture.beaive.com`:** proxy to `127.0.0.1:3100`, `/socket.io/` upgrade,
  `client_max_body_size 100m`, request buffering off on the clips route, and rate limits. TLS via
  `certbot --nginx`. Test with `nginx -t` before every reload.
- **Secrets** in a root-only `infra/.env` on the host: `JWT_SECRET`, `POSTGRES_PASSWORD`, `PATIENT_DATA_KEY`.
- **User action:** delete the dead `124.243.134.74` A records for posture.beaive.com and medbuddy.beaive.com
  (BigRock), and change the `ubuntu` password (it was shared in chat).

## Milestones (each = server deploy + TestFlight build of `com.beaive.posturepulse`)
Every milestone runs `npm run backend:test`, `pytest` in ml-service, `npm run schemas:check`,
`npm run lint:claims`, the iOS tests, and an end-to-end check against `https://posture.beaive.com`.

1. **M0 – Foundations**
   - Work:
     - Safety-machine fix with spec tests.
     - Kinematics aspect-ratio fix with a regression test.
     - Remove Caddy and Redis, add the nginx site, deploy to the new host.
     - Remove torch from the image; write ADRs 013–017.
     - iOS: remove the AR session and add the mode chooser screen.
     - Benchmarks: the full model's ms/frame on the server CPU; 60 fps back-camera formats on iPhone and the iPad
       mini A17 Pro.
   - Verify:
     - A symptom reported in Setup or Unavailable moves the session to Pause.
     - `/health` responds over HTTPS and the socket upgrade works.
     - The other sites on the host are unaffected (curl each nginx site before and after).
2. **M1 – Static battery end to end, both modes**
   - Work: clip pipeline, static metrics, not-measurable rows, reference file v0, patient register, review page,
     sign-off and release.
   - Verify:
     - A phone rolled 5° leaves the corrected shoulder tilt unchanged.
     - Cropped feet give an unsupported row with a reason.
     - A signed report appears on iPhone and iPad.
3. **M2 – Functional movements and contraindication flow**
   - Verify:
     - Rep counts match `RepCounterService` on shared fixtures.
     - A landing at 30 fps is reported as unsupported.
     - A contraindication moves the session to Pause.
4. **M3 – Gait**
   - Verify:
     - A 30 fps clip reports cadence only.
     - Gait event timing agrees with hand-labelled frames to within ±1 frame.
5. **M4 – Workstation, ergonomic tools and keyframe annotator**
   - Verify:
     - Tool totals match the published worked examples.
     - A missing input gives "Incomplete".
     - The tools are hidden in the patient view.
6. **M5 – Hardening:** PDF, amendments, retention job, visit comparison, LiDAR spike.
7. **Later:** MedBuddy explanations (medbuddy.beaive.com), LiDAR depth for scale/rotation/screen distance, and
   ASIS/PSIS marker annotation.

Execution goes through the brainstorming spec → writing-plans → TDD flow: one detailed task plan per milestone,
starting with M0.
