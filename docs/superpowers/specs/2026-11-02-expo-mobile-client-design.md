# Expo mobile client — design

> Status: agreed design, not yet implemented. Supersedes the SwiftUI client
> (`apps/ios-client`), which is archived as part of P1.

## Context

The SwiftUI client works but its UI quality is poor enough that it blocks
demonstrating the product. Rather than another pass over it, the mobile client is
rebuilt from scratch in Expo / React Native with EAS, targeting a clinic-operated
workflow.

Only the **client** is replaced. The NestJS backend, the Python ML service, the
schema package and the clinician web dashboard are unchanged, and P1 deliberately
requires **zero new backend endpoints** — every API it needs is already running in
production at `https://posture.beaive.com`.

The app is **clinic-only**: the person logging in is a clinician, who assesses
patients. There is no patient-facing login and no mode chooser.

## Non-negotiable constraints

These come from `docs/claims-and-scope.md` and `CLAUDE.md`, and they bound every
screen in every project below. They were discussed explicitly during design; the
decisions recorded here are the resolved positions, not open questions.

| Requested | Decision | Reason |
|---|---|---|
| "Clinical pharmacological management" | **Not built.** | Medication guidance from a camera scan is Level E (disease treatment) — out of scope, separate regulatory track, and a regulated device function. |
| "Diagnosing…" in the analysis animation | **Not used.** Copy is "Analysing", "Computing joint angles", "Locating landmarks". | `scripts/lint-claims.sh` greps `diagnos` in `.tsx` and fails the build. The alternatives also read as more technical. |
| "normal" column | **"Reference"** + `DRAFT` badge + source citation. | Naming a value "normal" asserts an unvalidated clinical norm. |
| "benchmark point" column | **"Position"**: below / within / above / indeterminate. | A score implies medical meaning; a position is an observable fact. |
| Gamified posture score / grade / streak | **Not built.** | An unvalidated composite number presented as medically meaningful is explicitly prohibited. Gamification rewards the **process**, never the **body**. |
| AI explains why *this* patient is like this | **Constrained** — see "AI-drafted assessment". | A patient-specific causal claim from camera geometry is a diagnosis, and the camera cannot distinguish a short muscle from a habit from pain avoidance, so free generation would confabulate. |

The product-wide rule for interpretive copy: **the app may explain the
measurement; it may not explain the person.** Text that is identical for every
patient and cites a source is reference material. Text that asserts a cause for
this patient's readings is a diagnosis.

## Architecture

### The measurement split (unchanged from the SwiftUI client)

On-device pose estimation is used **only** for live framing guidance and capture
quality. **Every number that is ever reported comes from MediaPipe on the
server.** This is what keeps provenance (`CLAUDE.md` rule 4), the quality gate
(rule 3) and the planned validation study meaningful, and it is why the on-device
model is never asked to produce a reported value.

```
phone: MoveNet (guidance only) ──┐
                                  ├─→ PUT /sessions/:id/clips/:stepId
phone: records clip ─────────────┘        (multipart: clip + ClipCapture sidecar)
                                                    │
                                   backend-api → ml-service (MediaPipe)
                                                    │
                                        metric-result events → report
```

### Stack

- **Expo + EAS with a custom dev build.** Expo Go cannot run camera frame
  processors, so the custom dev build is required from day one — this changes the
  dev loop and is not optional.
- `react-native-vision-camera` for capture; `react-native-fast-tflite` with
  **MoveNet** for on-device pose in P2. (PoseNet is deprecated; MoveNet is its
  replacement.)
- `@beaive/schemas` is imported directly for types — it already emits
  `generated/ts/index.d.ts`. The new app joins the npm workspaces list.
- Lives at `apps/mobile`.

### Camera screen

**Full-bleed preview, edge to edge.** The subject fills the screen; overlays float
on top. The previous client boxed the preview, which made people look like toys.

Consequence that must be handled in P1: a full-bleed preview on a tall phone
screen crops a 4:3 or 16:9 sensor frame. **What is framed must equal what is
recorded**, or subjects get cut off in the clip the server actually measures.
Select a capture format whose aspect ratio matches the display and record that
format, rather than displaying a crop of a wider recording.

## Project breakdown

Five projects, each producing a working app. Each gets its own plan.

| | Scope | Backend work |
|---|---|---|
| **P1** | Walking skeleton: login → pick patient → capture 4 poses → upload → real measurements | none |
| **P2** | AR capture guidance: frame processor, MoveNet, live skeleton, framing + quality checks | none |
| **P3** | Report, cited notes, protocol suggestions, branded PDF, export-equals-sign | moderate |
| **P4** | AI-drafted assessment composed from approved notes | new endpoint |
| **P5** | Home analytics + billing quota | substantial (quota model, counters, enforcement) |

P2 is sequenced after P1 deliberately. If camera, pose and upload are built
together and the numbers come back wrong, there is no way to tell which layer is
at fault. P1 proves the pipeline carries real data; P2 adds the skeleton on top of
a known-good pipeline.

P4 depends on P3, because P3's note library is P4's source material.

---

# P1 — Walking skeleton (this spec)

**Goal:** a clinician logs in on a real device, picks a patient, captures four
poses, and sees real measurements returned by the production server.

Deliberately ugly. No AR, no AI, no PDF, no quota, no analytics, no splash
animation. Those are P2–P5.

## Screens

1. **Login** — username + password → `POST /auth/login`, returns clinician JWT.
   Token stored in `expo-secure-store`. Reuses the existing clinician auth; no
   patient or clinic chooser.
2. **Permissions** — camera and microphone, requested after login with a plain
   explanation of why each is needed.
3. **Home (stub)** — a list of recent scans and a single **New scan** button. The
   four analytics widgets (scans-over-time chart, totals, pending reports, recent
   scans) are P5.
4. **Patient picker** — search over the existing encrypted register
   (`GET /patients?q=`), plus create-new. A scan must attach to a patient, so this
   gates entry to capture.
5. **Consent** — captured per visit before the session opens
   (`POST /consent`), as the SwiftUI clinic mode already does. The clinic runs on
   a shared device, so consent is per-visit rather than remembered.
6. **Capture** — full-bleed preview, static silhouette outline and written
   instructions per pose, countdown, record, repeat for front / left / right /
   back. Hold ring and live skeleton are P2.
7. **Analysis** — the honest six-stage sequence (see below) while clips upload and
   analysis runs.
8. **Results** — plain list of returned metrics: label, value ± uncertainty,
   reference, position. No row detail, no plan section, no export.

Also in P1: **archive `apps/ios-client`** in a single commit once the flow above
works on a device, so there is only one mobile client.

## Session flow

Reuses the existing contract end to end:

1. `POST /sessions` — subject pseudo-id, protocol id/version, deployment context
   `clinic_supervised`, consent record id, retention policy.
2. Consent is captured per visit, as the SwiftUI clinic mode already does.
3. `GET /assessment-battery` for step ids and titles.
4. Per step: `PUT /sessions/:id/clips/:stepId` — multipart `clip`
   (video/mp4 or quicktime, ≤100 MB) plus `sidecar` (ClipCapture JSON).
5. Subscribe to the existing session WebSocket gateway
   (`src/ws/session.gateway.ts`) for `metric-result` events, falling back to
   polling `GET /sessions/:id/events` when the socket is unavailable.

Patient linkage uses the existing clinic-mode mechanism — the visit gets a fresh
pseudonymous subject id, linked to the patient record, with identifying fields
never entering the event log (ADR-012, ADR-017).

## The analysis animation

The one piece of polish included in P1, because it covers real waiting time and
sets the tone.

Six stages, each literally true of the running pipeline:

1. Uploading 4 clips
2. Extracting frames
3. Locating 33 body landmarks
4. Computing joint angles
5. Checking measurement quality
6. Comparing with references

Counters count to the **real** values for that scan, not invented ones. When
landmark data returns, the skeleton drawn is **that patient's actual landmarks**.
This is what makes it feel earned rather than decorative — and it makes no claim,
because describing computation is not describing health.

## Error handling

- **Network loss mid-capture** — clips are written to local storage first and
  uploaded with retry. A half-finished session is resumable rather than lost.
- **Upload rejected** (`ClipUploadStateGuard`) — surface the server's reason;
  never silently drop a capture.
- **Analysis incomplete or quality-gated** — a metric returned as `unsupported`
  or `notMeasurable` is shown **with its reason**, never omitted and never
  back-filled with a guess (`CLAUDE.md` rule 3).
- **401** — clear the stored token and return to login.
- **Permission denied** — explain what is blocked and link to system settings.

## Testing

- Unit tests for the API client against the real response shapes from
  `@beaive/schemas`.
- A contract test asserting the client's expected shapes match the generated
  schema types — the clinician-web `record.body` bug came from exactly this gap,
  where the client's declared type and the server's actual response diverged while
  all mocked tests passed.
- Manual on-device verification against `posture.beaive.com`, since a simulator
  cannot validate camera framing.

## Verification

P1 is done when, on a physical device against the production backend:

1. A clinician logs in and the token persists across app restarts.
2. A patient is found in the register (or created) and selected.
3. Four poses are captured with the subject filling the frame, and the recorded
   clip matches what was previewed.
4. All four clips upload, with a deliberate airplane-mode interruption recovering
   rather than losing the session.
5. Real metric values appear, matching what `GET /reports/:id` returns for the
   same session on the web dashboard.
6. A quality-gated metric displays its reason rather than disappearing.
7. `npm run lint:claims` passes over the new app.

## Dependencies and open items

- **The nine cited notes (P3) need a clinician author.** I can draft them for
  review; they must be reviewed and signed off by a clinically qualified person
  before shipping. A clinical licence qualifies someone to approve this content —
  it is separate from device certification, which no individual grants.
- **EAS account and build credentials** are needed before P1 can run on a device.
  The existing Apple team currently cannot export builds until the Account Holder
  accepts the updated Program License Agreement.
- **Billing quota (P5)** is an unspecified commercial decision — plan tiers,
  limits, and what happens when a clinic hits zero mid-consultation.

## Decisions deferred to later projects, recorded here so they are not lost

- **Row detail card (P3)**: measured → reference + citation → "what this can
  indicate" (cited note) → protocols to consider, with contraindications and
  symptom-stop rules shown.
- **Plan section (P3)**: surfaces the three existing draft protocols
  (bodyweight squat, shoulder flexion/abduction, sit-to-stand); the clinician
  selects and edits. Nothing is auto-prescribed.
- **AI-drafted assessment (P4)**: composes per-patient prose from the
  clinician-approved note library plus that scan's measurements. It selects and
  phrases approved material; it does not generate novel clinical claims, name
  causes, predict outcomes or mention medication. Recorded as AI-drafted in the
  report's provenance.
- **Export equals sign (P3)**: there is no separate approval step. Sharing the
  PDF signs the report in the clinician's name and writes the audit entry, so the
  exported document carries a signature and content hash without extra friction.
  An unexported AI draft remains an unsigned draft.
- **Gamification (P2/P3)**: hold ring that fills only while the pose is correct,
  haptic on lock, pose medallions, capture-quality badges, staggered result reveal
  with count-up numbers. All reward capture technique and task completion.
