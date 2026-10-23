# ADR-013: Clip-based analysis for the static battery

## Status
Accepted (M1). Amends ADR-003 for assessments; ADR-003 still describes the
per-frame transport used by exercise sessions.

## Context
The static battery (front, left, right, back views) measures a person holding
still. That needs true vertical (not the phone's edges), real frame timing, a
heavier pose model than the on-device one, and the freedom to re-run the
analysis when the metrics change. Streaming single frames to
`POST /internal/frames` loses the frame timing and the gravity direction, and
couples the result to the network at capture time.

## Decision
- The app records one 30 fps clip per step, with a per-frame sidecar
  (`clip-capture.schema.json`: frame index, presentation time, gravity vector
  in the camera frame, device, intrinsics when known) and uploads both with
  `PUT /sessions/:id/clips/:stepId`.
- backend-api validates the sidecar against the schema and the route
  (sessionId, stepId, view), stores the file as `CLIP_DIR/<clipId>.mov` with its
  sha256, and queues one `AnalysisJob` row. The upload is refused with 409 while
  the session's safety state is Pause, Unavailable or ClinicianReview. The route
  only reads the safety state; it never sends safety events.
- An in-process job runner (`ANALYSIS_CONCURRENCY`, default 2, polling every
  second) claims jobs with one `UPDATE ... WHERE id = (SELECT ... FOR UPDATE
  SKIP LOCKED LIMIT 1)` statement on Postgres. No new infrastructure: the table
  is the queue, and several backend instances can run side by side. A job left
  running by a stopped worker is picked up again after 15 minutes.
- The runner calls ml-service `POST /internal/clips/analyze` with the clip path
  on a shared volume (`clipdata`, mounted at `/data/clips` in both services),
  checks that every requested metric came back exactly as a `MetricResult` for
  this session, clip and step, appends each one to the event log with
  `EventsService.appendValidated(..., "metric-result", ...)`, and marks the clip
  analysed. A failure is retried up to 3 times, then the job and clip are marked
  failed. A bad video never produces a guessed value: content problems come back
  from ml-service as `unsupported` results with quality reasons.
- The clip file is deleted after analysis (or after the final failed attempt)
  unless the session's consent includes the `raw_video` scope. If the consent
  cannot be read, the file is deleted. Landmark series written by ml-service are
  derived data and follow the derived-events retention.
- A re-upload of a step is a new clip; the newest analysed clip per step is the
  one reports use. A retried upload with the same `clipId` and bytes is answered
  from the stored row.
- `GET /sessions/:id/steps` reports each step as missing, processing, analyzed or
  failed, with `usable` and the quality reasons, so the app can offer a redo.
  It exposes no measured numbers.

## Consequences
- Uploads can be large (up to 100 MB; the shared-host nginx allows it). The
  clip is streamed to disk, not held in memory.
- Analysis is asynchronous: the app polls the steps route.
- Exercise sessions are unchanged and keep using per-frame streaming.
- The runner's claim query is plain SQL on Postgres; it has been exercised
  against fakes in unit tests and needs a run against a real database during
  deployment checks.
