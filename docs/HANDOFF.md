# HANDOFF — PosturePulse AI (beAIve) — local Mac session → cloud session

Written 2026-10-23 ~17:00 IST by the Claude Code session that ran on the owner's Mac.
Read this whole file first. Section 4 is the to-do list, in order.
Companion files: `docs/superpowers/plans/2026-10-23-v2-overall-plan.md` (approved overall plan),
`docs/superpowers/specs/2026-10-23-m1-static-battery.md` (M1 spec, the contract between the four slices),
`CLAUDE.md` (non-negotiable rules).

---

## 0. Read this first — ten things that will bite you

1. **There is no git remote.** The repo was `git init`-ed locally. To reach the cloud session it must be pushed to a
   private GitHub repo (or restored from a bundle — see 4.A). Nothing has been pushed anywhere. Do not push without the
   owner's OK. A full secret scan of every branch and all history was clean (no tokens, keys or credential files).
2. **Secrets are not in git and must be re-supplied.** `.env` (OpenRouter key), the App Store Connect `.p8` key, the
   server `infra/.env`, the SSH access and the sudo password all live outside the repo (section 7). Never write a
   secret into a file, commit message, log or chat.
3. **iOS build / TestFlight needs macOS + Xcode.** A cloud (Linux) session cannot build, test or upload the iOS app.
   Any step marked **[MAC]** below must be run by the owner on their Mac (or by a Claude session running there).
4. **Server access is by SSH key from the owner's Mac only.** The cloud session has no key. Either the owner adds the
   cloud session's public key to `~/.ssh/authorized_keys` on the server, or the owner runs the commands. `sudo` needs a
   password the owner knows. The password was pasted in an earlier chat: **the owner should change it** (4.I).
5. **The server is shared with ~10 unrelated projects.** Only touch the `posturepulse` compose project, the
   `posture.beaive.com` nginx site and (later) `medbuddy.beaive.com`. Never restart nginx without `nginx -t`, never
   prune Docker, never touch other containers or ports. Baseline check in 6.4.
6. **Product rules (CLAUDE.md) are legal-grade, not style.** No diagnosis or condition names, no "normal/abnormal",
   no grades ("excellent"), no causes/risk/advice, no composite or health score, no red/amber/green. Never invent a
   measurement — use `unsupported` / `notMeasurable`. A symptom report must always pause the session. Never edit
   `status` / `clinicallyValidated` in `protocols/*.json`. Run `npm run lint:claims` before every commit.
7. **Schemas are generated.** Edit only `packages/schemas/src/*.schema.json`, then `npm run schemas:generate`, commit the
   generated output; `npm run schemas:check` must pass. Needs `datamodel-code-generator` installed (venv recipe in 6.6).
8. **The four M1 slices are finished but NOT merged.** They sit on branches `m1-ml`, `m1-backend`, `m1-web`, `m1-ios`
   (in git worktrees under `.claude/worktrees/`). They merge cleanly (verified) — merging is task 4.B.
9. **Nothing from M1 is deployed.** The server and TestFlight build 2 contain M0 only. The M1 work has only been tested
   with fakes/mocks — **the full chain (iOS → upload → job queue → ml-service → report → clinician sign-off → patient
   view) has never run end to end.** That is the main risk; task 4.E.
10. **The owner types fast with typos and wants short, concrete replies and working software.** They said "continue"
    / "ok" to mean "go ahead". Ask only when genuinely blocked; surface decisions with a recommendation.

---

## 1. The product in five lines

PosturePulse AI is a clinician-supervised posture and movement assessment: a phone/iPad records short video clips of a
fixed battery (static standing views first), a server estimates body angles with MediaPipe, a clinician reviews and
signs a report, and the patient sees it. Results are **measurements with uncertainty, a cited draft reference range
and an "outside reference" flag — never a diagnosis or a score**; the clinician writes any interpretation. Two session
modes, chosen at start: **Clinic mode** (clinician signs in, picks a patient from a server-side encrypted register,
runs the battery) and **Patient mode** (self-guided, results only after clinician release). Modules planned:
Static (M1), Functional (M2), Gait (M3), Workstation/ergonomic tools RULA/REBA/OWAS/NIOSH (M4), hardening/PDF (M5).

Stack: iOS SwiftUI app (`apps/ios-client`) · NestJS + Prisma/Postgres backend (`services/backend-api`) · Python/FastAPI
ML service (`services/ml-service`) · React clinician dashboard (`apps/clinician-web`) · JSON-Schema contracts
(`packages/schemas`) · MedBuddy (separate repo, explanation sentences) · hosted on one shared Ubuntu server.

---

## 2. State at handoff

### 2.1 Branches (all local)

| Branch | Tip | What it is |
|---|---|---|
| `v2-m1` (checked out) | `c170ca7` + this handoff commit | M0 + M1 contracts + M1 spec + TestFlight script. **Integration branch.** |
| `m1-ml` | `092abfd` | ML slice, 9 commits. pytest **180 pass**. Review done, all findings fixed. |
| `m1-backend` | `c975b13` | Backend slice, 16 commits. jest **378 pass** (40 suites). Review done, all findings fixed. |
| `m1-web` | `926fbb3` | Clinician-web slice, 13 commits. vitest **126 pass**, build + tsc OK. Review done, all fixed. |
| `m1-ios` | `1b54adb` | iOS slice, 10 commits. **98 tests pass.** **Adversarial review never ran** (usage limit) — task 4.D. |
| `v2-m0`, `piece1-session-token`, `master` | — | Earlier history. `v2-m1` contains all of it. |
| `worktree-wf_5df85780-ff4-*` | — | Auto-created empty helper branches. Delete after merging. |

Worktrees: `.claude/worktrees/wf_5df85780-ff4-{1..4}` = ml, backend, ios, web. They are untracked (`.claude/` is not
committed). After merging, remove with `git worktree remove --force <path>` then delete the branches.

### 2.2 Verified on a trial merge of all four slices into `v2-m1` (scratch worktree, since deleted)
Clean merge, no conflicts. backend 378/378, web 126/126 + `tsc -b`, `schemas:check` up to date, `lint:claims` passed.
(ml 180 and iOS 98 were run on their own branches; those directories are touched by one slice only.)

### 2.3 Deployed / live
* **Backend (M0 code)** at `https://posture.beaive.com` (Let's Encrypt cert valid to 2027-01-21). `/health`,
  `/protocols`, consent, sessions, ADR-012 session tokens, symptom pause-from-any-state, Socket.IO all verified live.
* **TestFlight:** app `com.beaive.posturepulse`, **build 2** (M0: mode chooser, clinician sign-in, no AR). Installed on
  reainmaker@icloud.com's iPad; arunkumar.anr@gmail.com invited.
* **Server database is empty** (old server's data is gone; it was test data only).
* **MedBuddy: not deployed.** Code exists as a patch (4.H).

### 2.4 Test baselines to protect
backend 378 (40 suites) · web 126 (20 files) · ml-service 180 · iOS 98 · schemas 11 contract tests · MedBuddy 263 (src/cds + src/api).

---

## 3. What is DONE (do not redo)

**M0 (merged on `v2-m1`, deployed):**
* Safety fix: `SYMPTOM_REPORTED` and new `CONTRAINDICATION_FLAGGED` now go to **Pause from every non-terminal state**
  (before, Setup and Unavailable dropped symptom reports). Spec tests in `safety-state-machine.spec.ts`.
* Kinematics fix: angles measured in **pixel space** (MediaPipe's normalized x/y have different scales on non-square
  frames). Regression tests in `services/ml-service/tests/test_kinematics.py`.
* Hosting: compose project `posturepulse`, host nginx + certbot, ADR-016; Caddy and unused Redis removed.
* iOS: Clinic/Patient mode chooser, clinician sign-in, fresh pseudonymous id per clinic visit, AR session removed,
  iPad support, brand assets, design system, one-command TestFlight script.
* Earlier "piece 1": consent flow, session-scoped subject tokens (ADR-012), gateway auth, Socket.IO client.

**M1 contracts (on `v2-m1`):** schemas `clip-capture`, `metric-result`, `reference-range-set`, `assessment-battery`,
`assessment-report`; shared quality-gate reasons; provenance fields; `references/assessment-battery.v0-draft.json`,
`references/posture-reference.v0-draft.json` (draft, `reviewedBy: null`).

**M1 slices (on their branches, tested with fakes):**
* **ml:** `POST /internal/clips/analyze`, `GET /internal/metrics/catalog` (incl. the always-listed *not measurable* set),
  PyAV decode + MediaPipe full model in VIDEO mode, gravity roll/pitch correction, 11 static metrics with sign
  conventions/tiers/uncertainty, quality gate reasons, gzip landmark series with sha256, provenance on every result.
* **backend:** clip upload (multipart, 409 while Paused/Unavailable/ClinicianReview), Postgres job queue
  (`FOR UPDATE SKIP LOCKED`), ml client, deterministic report builder (below/within/above/indeterminate/no_reference/
  not_applicable) with fixed banned-phrase-checked templates, clinician review routes, sign-off with password
  re-verification + content sha256, report-access token for patients, AES-256-GCM encrypted patient register
  (`PATIENT_DATA_KEY`), ADR-013/015/017, `references/banned-phrases.json`.
* **web:** report queue, report review (keep/exclude rows with reasons, assessment text, sign-off dialog, reject),
  patient register page, safety-state warning, neutral display helpers. Also fixed: `npm run web:test` used to report
  "no tests" (vitest root/include pinned).
* **ios:** battery fetch, `GuidanceEngine`, `BatteryRunner`, `ClipRecorder` (HEVC + per-frame gravity sidecar), upload
  actor queue with file protection, step-status polling, patient picker, report mapping + readout, "Your results"
  (report-access token in Keychain). Symptom stop is local-first and always visible. Per-frame streaming removed.

**MedBuddy (separate repo, patch in `docs/handoff/`):** `POST /v1/posture/explain` — strict request (no identifiers),
refuses rows whose position contradicts their numbers (422), deterministic template narrator, consistency guard
(banned phrases, numbers the row does not own, direction vs position), optional OpenRouter narrator. **Model chosen:**
`mistralai/mistral-small-3.2-24b-instruct` — benchmarked through the real guard on synthetic rows: 30/30 faithful,
~1.1 s, ≈ $0.035 per 1,000 rows. Others tried (faithful-sentence rate): llama-3.1-8b 23/30, gemma-3-12b 27/30,
mistral-nemo 27/30 (cheapest, ≈ $0.01), claude-haiku-5.5 23/30, gpt-oss-120b/20b 1–2/30 (reasoning models break the
JSON contract). OpenRouter lists **no medical-tuned model**; for one-sentence measurement wording it would add nothing
because the guard, not the model, keeps text safe. One live call through the real key worked.

---

## 4. What REMAINS — do in this order

Legend: **[CLOUD]** a cloud session can do it · **[MAC]** needs the owner's Mac/Xcode · **[OWNER]** needs the owner ·
**[SERVER]** needs SSH to the server (owner grants access or runs it).

### 4.A Get the repo into the cloud session — [OWNER], 5 minutes
Option 1 (recommended): create a **private** GitHub repo, then
```bash
cd /Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1
git remote add origin <PRIVATE-REPO-URL>
git push -u origin --all          # all branches, incl. m1-ml m1-backend m1-web m1-ios v2-m1
```
Option 2: the bundle `~/Downloads/posturepulse-handoff.bundle` was created alongside this file:
`git clone posturepulse-handoff.bundle posturepulse && cd posturepulse && git branch -a` (all branches included).
Untracked and not transferred either way: `.claude/` (worktrees), `.env`, local caches. That is intended.

### 4.B Merge the four slices into `v2-m1` — [CLOUD], 10 minutes
```bash
git switch v2-m1
for b in m1-ml m1-backend m1-web m1-ios; do git merge --no-ff -m "Merge $b (M1)" $b; done   # verified conflict-free
git worktree prune; git branch -D worktree-wf_5df85780-ff4-1 worktree-wf_5df85780-ff4-2 worktree-wf_5df85780-ff4-3 worktree-wf_5df85780-ff4-4
```
Then re-verify (6.6 has env setup): `npm ci && (cd services/backend-api && npx prisma generate && npx jest)` →
378 pass · `npm run web:test && npm run web:build` → 126 pass · `npm run schemas:check` · `npm run lint:claims` ·
ml: `pytest -q` in `services/ml-service` → 180 pass · iOS **[MAC]**: 98 pass (6.7). Commit nothing else until green.

### 4.C Fix the cross-slice contract mismatches — [CLOUD], ~half a day  ← do BEFORE any integration run
The slices were told not to edit schemas, so they worked around gaps. Each item below was raised independently by two
slices; recommended resolution given. Decide, then implement test-first, regenerate schemas, update both sides.

| # | Gap | Recommended fix |
|---|---|---|
| 1 | `assessment-report` rows have no **`stepId`** → iOS/web cannot separate left/right rows sharing a metric key | Add optional `stepId` (string) to the report row schema; backend report builder fills it from `metric-result.stepId`. — **done**, see commit history on `v2-brand` |
| 2 | Row `reference` has only a text label; iOS parses "0-5 deg" strings to draw the band | Add numeric `min`/`max` (+ `kind`, `status`) to the row's `reference`; builder fills them; iOS/web stop parsing text. — **done**, see commit history on `v2-brand` |
| 3 | No **`signConvention`** on report rows (exists on `metric-result`), so a "-1.3°" has no stated meaning in the UI | Add optional `signConvention` to the row; builder copies it; web already renders it. — **done**, see commit history on `v2-brand` |
| 4 | `GET /sessions/:id/steps` has no **`clipId`**; after a Redo, polling can show the previous clip's status | Include `clipId` per step; iOS already ignores a status with another clipId. — **done**, see commit history on `v2-brand` |
| 5 | Landmark series stored at `landmarks/<clipId>.json.gz`; re-analysis overwrites bytes earlier results cite | Make the path sha-qualified: `landmarks/<clipId>/<sha256>.json.gz`; evidence stores the sha (already does). — **done**, see commit history on `v2-brand` |
| 6 | Sign-off cannot detect a concurrent edit | `POST /reports/:id/sign-off` accepts `contentSha256`/`reportVersion`; **409** on mismatch. — **done**, see commit history on `v2-brand` |
| 7 | Sign-off wrong password and invalid token are indistinguishable | Wrong password → **403** with a code; expired/invalid token → **401**. Remove the client's extra GET. |
| 8 | Sign-off lockout counter is per process | Fine on one instance. Move to the DB before running >1 backend instance. |
| 9 | `report-rejection/v0` is an event id with no registered schema | Optional: add a schema in `packages/schemas/src` in the same pass. — **done**, see commit history on `v2-brand` |
| 10 | Response shapes iOS assumes (confirm backend matches): multipart `sidecar` JSON text field *before* the `clip` file part (filename `clip.mov`, `video/quicktime`); upload → `{clipId,status}`; `GET /steps` array or `{steps:[…]}`; `GET /released-report` body or `{…,body}` with **404 = pending review**; `POST /patients` and `GET /patients?q=` → `{id,name,dateOfBirth(YYYY-MM-DD),contact?}` | Write one contract test per item on the backend side using the iOS decoders' fixtures. |
| 11 | Released body still contains rows a clinician **excluded** (kept so the signed hash verifies); the patient route omits them but `GET /sessions/:id/released-report` may not | Confirm the patient-facing route never returns excluded rows' numbers; iOS already hides + counts them. |

Follow `packages/schemas/CHANGELOG.md` for version bumps. Update `docs/traceability-matrix.md` if a hazard control or
version mapping changes.

### 4.D Finish the iOS review — [CLOUD or MAC], 1–2 h
The adversarial review of `m1-ios` never ran. Review it against the spec "Slice C" with fresh eyes: guidance rules,
symptom-stop precedence (local before network, always visible), token handling, upload queue (401 drops the clip —
intended; token is 4 h), Keychain use, no numbers shown during capture, report mapping for every position incl.
`indeterminate`/`no_reference`, no diagnostic wording, no leftover references to removed files. Fix findings test-first.
Known unverified-on-device assumptions are in 4.G.

### 4.E End-to-end integration run — [CLOUD or SERVER], the most important step
Goal: prove the real chain works, including the SQL never executed against a real Postgres.
1. Bring the full stack up with real Postgres (locally with Docker, or on the server): migrations apply
   (`prisma migrate deploy` runs in the container CMD), ml-service healthy with the **full** pose model present.
2. Create a clinician: `cd services/backend-api && npx ts-node scripts/seed-clinician.ts <username> <password>`.
3. Run a scripted flow with `curl` or a Node script. Routes added in M1 (all in `services/backend-api/src/`):
   `GET /assessment-battery` · `PUT /sessions/:id/clips/:stepId` (subject token) · `GET /sessions/:id/steps` ·
   `POST /sessions/:id/report` · `POST /sessions/:id/report-access` · `GET /sessions/:id/released-report` (report-access
   token, 404 = pending) · clinician: `GET /reports`, `GET /reports/:reportId`, `POST /reports/:reportId/{rows/exclude,
   assessment,sign-off,reject}` · patients: `POST /patients`, `GET /patients?q=`, `POST /patients/:patientId/link`,
   `GET /patients/:patientId/sessions`. Flow: consent → session → steps → **upload a real clip with sidecar** →
   watch the job go `pending → running → done` → `GET /internal/…` metric results → build draft report → clinician
   login → review → sign off → released report fetched with a report-access token.
4. Verify the claim/reap/retry SQL (`FOR UPDATE SKIP LOCKED`, `INTERVAL '15 minutes'`): two concurrent uploads, kill the
   worker mid-job, confirm reaping.
5. Negative cases: upload while Paused → 409; upload without token → 401; excluded rows absent from patient view;
   patient route never shows another patient's report; logs contain no patient names or tokens.
You need a real test clip. Record one on a device (4.G) or use a short portrait HEVC/H.264 clip of a standing person
with a sidecar (`schemas`: `clip-capture`). Real people have never been fed to the pipeline yet — only synthetic video.

### 4.F Deploy M1 to the server — [SERVER], 1 h (after 4.B–4.E)
Server layout is in section 6. Steps:
1. Sync code (rsync excluding `node_modules .git dataset models *.xcodeproj infra/.env apps/ios-client`).
2. In the server's `~/posturepulse/infra/.env` (mode 600) **add `PATIENT_DATA_KEY`** =
   `openssl rand -base64 32`. **Back it up off-server** — losing it makes every stored patient name/DOB unrecoverable.
   (`POSTGRES_PASSWORD` and `JWT_SECRET` already exist there; never regenerate `POSTGRES_PASSWORD` for the live volume.)
3. **nginx gotcha:** the repo's `infra/nginx/posture.beaive.com.conf` was updated (rate limit zone, 100 MB body for
   clips, socket.io upgrade) but the *live* file `/etc/nginx/sites-available/posture.beaive.com` has the certbot-added
   TLS block. Do **not** overwrite it blindly: merge the new `location` / `limit_req_zone` / `client_max_body_size`
   lines into the live file (or copy the repo file then re-run `sudo certbot --nginx -d posture.beaive.com`), then
   `sudo nginx -t && sudo systemctl reload nginx`. Run the baseline check (6.4) before and after.
4. `docker compose -f infra/docker-compose.yml -f infra/docker-compose.server.yml --env-file infra/.env up -d --build`
   (the ml image now needs `av` and downloads the full pose model at build. **The planned "remove torch from the runtime
   image" was NOT done:** the `m1-ml` Dockerfile still installs `[detection,movement]` (torch, ~GBs, slow build) because
   `app/api/internal_routes.py` still imports `app.detection.*` and `app.movement.*` at startup. It works, it is just
   heavy; making those imports lazy/optional and dropping the extras is a safe optimisation — do it after 4.E, with
   the existing `/internal/frames` and `/internal/movement-window` tests kept green or removed on purpose.)
   A `clipdata` volume holds uploaded clips and landmark series.
5. Smoke: `curl https://posture.beaive.com/health`, then rerun the 4.E script against the live URL. Check
   `docker logs posturepulse-backend-api-1` for errors and that no PHI/tokens are logged.
6. Create the first real clinician account (owner picks the username; generate the password, hand it over once).

### 4.G Real-device testing + TestFlight — [MAC] + [OWNER]
`apps/ios-client/scripts/testflight.sh` (archives, signs via the ASC API key, uploads, waits for processing; build
number = UTC timestamp). Needs `~/.appstoreconnect/private_keys/AuthKey_JG79VW74QA.p8`, xcodegen, uv.
Then on a physical iPhone **and** the iPad mini (A17 Pro), in both modes, verify what simulators cannot:
* Back-camera recording works, HEVC portrait clip decodes on the server and the **display-matrix rotation**
  (`apply_rotation` in ml `pose_video.py`) is correct for a clip written by `AVAssetWriter` (unit-tested, never run on a
  real iOS clip). A size/sidecar mismatch fails safe as `insufficient_frames`.
* Vision left/right labelling is the person's own sides; the 0.3 guidance confidence threshold is sensible.
* The device sustains the target fps while writing HEVC and running Vision every 3rd frame; clips below a step's
  `minFps` are discarded with a Redo — confirm iPad behaviour.
* One sidecar entry per **encoded** frame (the server assumes decoded frame *i* = sidecar frame *i*).
* Intrinsics are always sent as `null` today (fine for M1).
* Symptom-stop mid-capture halts recording/speech before any network call; queued clips for that session are dropped.
* Landscape is not supported (portrait only); iPad is full-screen only.

### 4.H MedBuddy — [CLOUD] code, [SERVER] deploy, [OWNER] approvals
Source: repo `https://github.com/mabishek7272/anuclaw-medbuddy` (owner's other system). The work is **not pushed**.
It is saved here: `docs/handoff/medbuddy-posture-explain.patch` (`git am`, 2 commits on top of `7e81f69`) and
`docs/handoff/medbuddy-posture-explain.bundle`. To resume:
```bash
git clone https://github.com/mabishek7272/anuclaw-medbuddy && cd anuclaw-medbuddy && git switch -c posture-explain
git am /path/to/docs/handoff/medbuddy-posture-explain.patch
cd ANUClaw && npm install --ignore-scripts && npx vitest run src/cds src/api     # expect 263 pass
```
Remaining: (1) **[OWNER]** approve pushing the branch to GitHub; (2) deploy MedBuddy on the server (needs its own
Postgres + secrets; read `ANUClaw/README.md`, `setup.sh`; port plan: bind to 127.0.0.1 only; nginx site for
`medbuddy.beaive.com` + certbot; DNS already points there); (3) set `OPENROUTER_API_KEY` (or `POSTURE_LLM_API_KEY`) in
MedBuddy's server environment — `POSTURE_LLM_MODEL` overrides the default model, `POSTURE_LLM_DISABLED=1` forces
templates; (4) **build the beAIve → MedBuddy client in `services/backend-api` report builder** (not implemented; M1
ships fixed templates only): POST rows (no ids), 5 s timeout, then **re-check** every returned sentence in beAIve
(assertions == verdict, banned phrases from `references/banned-phrases.json`, no number not in the row) and fall back
to the beAIve template per row; record `analysis.source` (`medbuddy-llm` | `medbuddy-template` | `beaive-template`) in
the report row. (5) Rotate the OpenRouter key if it has been pasted anywhere.

### 4.I Security chores — [OWNER]
* **Change the server `ubuntu` password** (it was shared in chat) and prefer key-only login.
* Rotate the Kaggle, Hugging Face and AIKosh tokens and the old server's root password (all were pasted in chat;
  the old server is gone but treat them as exposed).
* The App Store Connect API key file is only on the owner's Mac: revoke it in App Store Connect if the Mac is shared.
* Before **any real patient data**: encryption at rest on the host disk/volume, a data-processing agreement, ethics /
  clinical sign-off of the reference file, backups of `PATIENT_DATA_KEY` and Postgres. Until then, **test data only**.

### 4.J Remaining milestones (after M1 is deployed and verified) — [CLOUD]
Follow `docs/superpowers/plans/2026-10-23-v2-overall-plan.md` and use the brainstorming → writing-plans → TDD flow,
one plan per milestone:
* **M2 Functional movements** + contraindication checklist flow (squat, single-leg squat, sit-to-stand, shoulder
  flexion, single-leg stance, optional landing ≥60 fps; FPPA per rep; rep segmentation shared with `RepCounterService`).
* **M3 Gait** (events at ±1 frame, cadence, stance/swing, asymmetry; 60 fps required).
* **M4 Workstation + RULA/REBA/OWAS/NIOSH** (clinician-only, "Incomplete" when inputs missing, keyframe annotator for
  C7/tragus and gaze) + `raw_video` gating.
* **M5** PDF export, amendments, retention job, visit comparison, LiDAR spike. Then ADR-014 (Vision for guidance only)
  and updating the "no on-device inference" statements in READMEs/SBOM/IEC 62304 docs.
* Housekeeping owed: trim torch from the ml image (see 4.F step 4); ADR-014 never written; `protocols/*.json` `captureSteps` (view/minFps/metricKeys) for M2+;
  remove `ProtocolSelectionView`/`ProtocolsClient` if the M2 module picker does not use them; oxlint warnings in web
  (set-state-in-effect) are non-blocking.

### 4.K Cleanup — [OWNER OK needed]
* An accidental Google Cloud SDK install (14:20–14:22 on 2026-10-23) had dumped two untracked 677 MB folders into the repo
  root (`source /` with a trailing space, and `y/`); they made the claims lint fail. They were **moved, not deleted**, to
  `~/Downloads/stray-gcloud-sdk-moved-out-of-posturepulse-repo/` on the owner's Mac. Delete that folder whenever the
  owner is sure nothing there is needed. (Not part of the project; never committed.)
* `scripts/lint-claims.sh` now also prunes `./.claude` (tooling/worktree copies of the repo were being scanned and failing
  the lint). It still scans every product directory (`.md .ts .tsx .py .swift .json`); verified with a probe file.
* Untracked `.claude/` holds the worktrees — delete after 4.B.
* `logo.zip` is tracked (brand files); fine to keep.

---

## 5. Decisions already made — do not re-ask

* All modules in **one app**; **Clinic mode vs Patient mode** chosen at session start.
* Results = measurement + uncertainty + cited **draft** reference + position; **diagnosis only by the clinician**, only in
  the clinician's free-text assessment. Position rule: "outside" only if the whole value ± uncertainty interval is outside;
  overlap ⇒ `indeterminate`; proxies/not-measurable show "no reference".
* **Rebuild the iOS app in this repo, keep the backend core** (consent, tokens, safety FSM, event log, audit, schemas);
  PostureAIPro (the owner's older project at `~/Downloads/Project/posture AI analysis/`) is reuse-only: Vision joint
  mapping and ideas; do **not** reuse its `BiomechanicsEngine` (fabricates 0), `Geometry` (folds tilts), GRDB store.
* **Patient identity lives on the server** in a clinician-only, field-encrypted, audited register linked to the
  pseudonymous `subjectPseudoId`; canonical schemas/event log stay identifier-free (ADR-017).
* **Clip-based server analysis** (ADR-013): device records HEVC clip + gravity sidecar; server runs MediaPipe full model
  in VIDEO mode; Vision on device is **guidance only** and never shows or uploads a measurement.
* Metric code exists **once**, in Python, with pytest. Trained movement-phase models are **not** used for report values.
* Analysis sentences: **fixed templates in M1**; MedBuddy later (code ready, not integrated).
* Host: the new shared server behind **host nginx + certbot**; compose project `posturepulse`, backend only on
  `127.0.0.1:3100`; Redis dropped; no Caddy.
* Session token lifetime 4 h; symptom reports are **never rejected for auth** (they only pause) — ADR-012.
* "AI" stays in the product name for now (open question in the plan: reconsider under the claims policy).

---

## 6. Environment facts

### 6.1 Server (shared, production-ish)
* Host `103.118.158.129`, Ubuntu 24.04, 8 CPU, 15 GB RAM, **no GPU**. SSH: `ssh -p 18755 ubuntu@103.118.158.129`
  (key auth installed from the owner's Mac; `sudo` needs the owner's password — not stored anywhere in the repo).
* UFW open: 22, 80, 443, 3000, 4000, 18755. Keep it that way; our backend is only on `127.0.0.1:3100`.
* Our stack: `~/posturepulse` · compose project `posturepulse` · containers `posturepulse-{backend-api,ml-service,postgres}-1`
  · secrets in `~/posturepulse/infra/.env` (600).
  Compose: `docker compose -f infra/docker-compose.yml -f infra/docker-compose.server.yml --env-file infra/.env <up -d --build|ps|logs>`.
* nginx: `/etc/nginx/sites-available/posture.beaive.com` (symlinked in `sites-enabled`), cert via
  `certbot --nginx` (auto-renew). Other sites there use the same pattern.
* DNS (BigRock): `posture.beaive.com` and `medbuddy.beaive.com` → `103.118.158.129` **only**. The old A record
  `124.243.134.74` (dead server) was removed in the panel; BigRock's four nameservers were still converging at handoff
  (TTL 4 h). Check: `for ns in $(dig +short NS beaive.com); do dig +short A posture.beaive.com @$ns; done`.
* **Do not touch:** containers `ai-smm_*`, `atrail_*`, `amgi_*`, `beaive_api` (127.0.0.1:8010), `beaive_mongo`,
  `~/posture-service` (an unrelated Python prototype on port 8000 — it has diagnostic-style wording and a posture
  score; do not reuse its wording), `~/corp-beaive` (port 3005), `simplicitytrap` (8001), other nginx sites.

### 6.2 Old server
`124.243.134.74` is **gone for good**. Lost with it: the test database, the KIMORE dataset, and the movement-phase
checkpoints trained there. The code remains (`app/movement/kimore_converter.py`, `train_entry_point.py`); the models
were never wired into reports and must not be (ADR-005).

### 6.3 Apple / TestFlight
Team `3J5T92268T` · bundle `com.beaive.posturepulse` · App Store Connect app id `6818384831` · Internal tester group
`c9c19d83-725c-4bc6-a833-00201be20886` (builds auto-appear for internal testers) · API key id `JG79VW74QA`, issuer
`bbcff6e1-7d7c-46aa-9b7c-7da72e9a2990` (identifiers, not secrets). Key file on the Mac only. Tested Xcode 27, iOS 27.0
simulator runtime, simulator "iPhone 17 Pro" id `55079423-C12B-40F0-979D-A182A2BD94E6` (this Mac only).

### 6.4 Baseline check for the shared server (run before and after any nginx/compose change)
```bash
ssh -p 18755 ubuntu@103.118.158.129 'for h in api.3rdi.in api.atrail.in application.irairf.com atrail.in bramha.net corp.beaive.com dev.atrail.in e-kalavya.com hcm.alamcap.com simplicitytrap.com; do printf "%s %s\n" $h $(curl -s -o /dev/null -m 10 -w "%{http_code}" --resolve $h:443:127.0.0.1 https://$h/); done'
```
Baseline on 2026-10-23: `api.3rdi.in 000 · api.atrail.in 404 · application.irairf.com 301 · atrail.in 200 · bramha.net 502 ·
corp.beaive.com 200 · dev.atrail.in 200 · e-kalavya.com 200 · hcm.alamcap.com 200 · simplicitytrap.com 000`
(some were already failing before we arrived — only *changes* matter).

### 6.5 Secrets inventory (names only — never print values)
| What | Where it lives | Notes |
|---|---|---|
| OpenRouter key | `<repo>/.env`, variable `openrouter` (gitignored, owner's Mac) | Used only by the MedBuddy benchmark/narrator. Provide to the cloud session as an env var if needed. |
| Server DB password, `JWT_SECRET` | server `~/posturepulse/infra/.env` | Generated on the server. |
| `PATIENT_DATA_KEY` | to be added to the same file (4.F) | Back up off-server. |
| ASC API key `.p8` | owner's Mac `~/.appstoreconnect/private_keys/` | Never commit (`*.p8` is gitignored). |
| Server sudo password / SSH key | owner | Cloud session needs its own key authorised. |
| Clinician accounts | created with `seed-clinician.ts` | No self-service signup. |

### 6.6 Local dev recipes
```bash
npm ci                                                       # root; installs all workspaces (Node 20+; this Mac uses fnm)
(cd services/backend-api && npx prisma generate && npx jest)  # prisma generate is REQUIRED after npm ci or 2 suites fail TS7006
npm run web:test && npm run web:build
# schemas: needs datamodel-code-generator
uv venv /tmp/cg && VIRTUAL_ENV=/tmp/cg uv pip install datamodel-code-generator && PATH=/tmp/cg/bin:$PATH npm run schemas:generate && npm run schemas:check
# ml-service
cd services/ml-service && uv venv -p 3.12 .venv && VIRTUAL_ENV=$PWD/.venv uv pip install -e ../../packages/schemas/generated/python -e ".[dev,detection,movement]"
bash scripts/fetch-pose-model.sh && .venv/bin/python -m pytest -q   # expect 180 on m1-ml
npm run lint:claims                                          # before every commit touching copy/docs/protocols
```

### 6.7 iOS recipes [MAC]
```bash
cd apps/ios-client && xcodegen generate          # after adding/removing files or packages
xcodebuild -project PosturePulse.xcodeproj -scheme PosturePulse -destination 'id=<SIM-ID>' -derivedDataPath <scratch>/dd test
scripts/testflight.sh [--no-upload] [--no-wait]
# design previews (DEBUG): launch with  -designPreview report|report-movement|capture|reps|setup
```
With `PosturePulse.xcodeproj` present, plain `xcodebuild` picks the project, not `Package.swift`.

---

## 7. Where things are

| Need | Path |
|---|---|
| Rules | `CLAUDE.md`, `docs/claims-and-scope.md`, `docs/consent-and-retention.md`, `docs/adr/` (011–017) |
| Overall plan / M1 spec | `docs/superpowers/plans/2026-10-23-v2-overall-plan.md`, `docs/superpowers/specs/2026-10-23-m1-static-battery.md`, `docs/superpowers/specs/2026-10-01-posture-report-design.md` |
| Contracts | `packages/schemas/src/*.schema.json` (edit) → `generated/` (never hand-edit) |
| Reference data (draft) | `references/` (battery, reference ranges; `banned-phrases.json` arrives with `m1-backend`) |
| Safety state machine | `services/backend-api/src/safety/safety-state-machine.ts` |
| Quality gate / metrics | `services/ml-service/app/quality/`, `app/metrics/`, `app/clips/` (on `m1-ml`) |
| Report builder / templates | `services/backend-api/src/reports/` (on `m1-backend`) |
| TestFlight script | `apps/ios-client/scripts/testflight.sh` |
| Hosting | `infra/docker-compose*.yml`, `infra/nginx/`, `docs/adr/016-shared-host-nginx.md` |
| MedBuddy patch | `docs/handoff/medbuddy-posture-explain.{patch,bundle}` |

## 8. How to resume in five commands
```bash
git switch v2-m1 && git log --oneline -5          # confirm you are on the integration branch
sed -n '1,60p' docs/HANDOFF.md                    # sections 0–2
# 4.B  merge the four slices (conflict-free), then re-run all suites
# 4.C  fix the contract mismatches (test first, schemas via generate)
# 4.E  run the real end-to-end chain before deploying anything
```
