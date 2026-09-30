# Posture & movement assessment report — design

Status: draft for review · 2026-10-01

## 1. Goal

A patient does a short guided assessment on the iOS app — a standing posture
scan plus three guided movements — and receives a detailed four-column report
(Metric / Your Scan / Theoretical Ideal / System Analysis) after a clinician has
reviewed and released it. The report is also viewable by the clinician on the
web dashboard and downloadable as a PDF.

The plain-language "System Analysis" sentences are written by MedBuddy's
explanation layer (a new endpoint), constrained so they can only describe the
measured result, never grade it, diagnose, or claim a cause.

## 2. Decisions (agreed with product owner)

| Topic | Decision |
|---|---|
| v1 content | Posture scan **and** guided movements (squat, sit-to-stand, shoulder raise) |
| Analysis text | MedBuddy new `/posture/explain` endpoint, reusing its explanation-service + consistency-guard pattern; beAIve falls back to its own templates |
| Reference ("Theoretical Ideal") values | Versioned draft file with a literature citation per metric; `status: "draft"` until clinical-lead sign-off |
| Audience | Clinician reviews and releases → patient iOS view → PDF export |
| Subject identity | Session-scoped token (earlier design, piece 1) |
| Thermal | Out of scope — no sensor. Never shown as a value; shown as "Not measured" only if a protocol asks for it |

## 3. Wording rules for the report

Allowed (descriptive, from the measured result):
- "Mild anterior carriage (~9.3° from the 90° reference)."
- "Slight lateral shift (~4.5°)."
- "Within the 0–5° reference range."
- "Left and right within 1° of each other."

Not allowed anywhere in patient- or clinician-facing report text (enforced in
code — §7.3):
- Grades: "excellent", "perfect", "textbook", "optimal", "normal", "healthy", "good/bad posture".
- Diagnosis or condition names ("scoliosis", "kyphosis", "valgus deformity", "dysfunction").
- Causes ("typical for screen-heavy workflows", "due to…", "caused by…").
- Impact or prognosis ("negligible impact", "risk of injury", "will improve").
- Treatment ("should stretch…", "strengthen…") — recommendations are the clinician's.
- Any number that is not in the input verdict.

Every metric row shows the estimate with its uncertainty (e.g. `81° ± 4°`), and
reference values show their source. A draft reference file shows a Draft badge
on the "Theoretical Ideal" column.

## 4. Architecture

```
iOS (guided flow)  ──frames + gravity──▶  backend-api  ──▶  ml-service
   ▲                                          │   ▲            (posture + angle metrics,
   │ released report / PDF                    │   └── metric frames, unsupported flags
   │                                          ▼
   │                                  ReportBuilder (deterministic)
   │                                          │ metric verdicts (no subject id, no video)
   │                                          ▼
   │                                   MedBuddy /posture/explain ──▶ sentences + assertions
   │                                          │
   │                                  beAIve re-check (assertions + banned phrases)
   │                                          │ fail/unreachable → beAIve template
   │                                          ▼
   └────────── released ◀── clinician-web review (draft → released | rejected)
```

Authority order (mirrors MedBuddy v3 §2.2 and beAIve ADR-005): safety state
machine > quality gate > deterministic report builder > explanation text >
clinician release. The explanation never changes a number or a classification.

## 5. Capture flow (iOS)

1. **Setup** — protocol + consent (piece 1). Phone level check using CoreMotion
   gravity: the scan waits until device roll and pitch are within ±3° of the
   orientation the step needs; a level indicator guides the user.
2. **Posture scan — front**: stand facing camera, arms relaxed, 5 s hold.
   Framing prompts from the quality gate ("Step back — feet not visible").
3. **Posture scan — side**: turn 90° (right side to camera), 5 s hold.
4. **Movements**: squat ×5, sit-to-stand ×5 (chair required), shoulder raise ×5
   per side. On-screen instruction + live rep count; the symptom stop button is
   always visible (unchanged local-first behaviour).
5. **Done** — "Your results will be available after your clinician reviews them."

Each frame upload carries the device gravity vector so image-plane angles can
be measured against true vertical rather than the phone's edges.

## 6. Metrics (ml-service)

All computed from MediaPipe landmarks already produced by the pipeline. Static
metrics are the median over the hold's accepted frames; uncertainty is the
combination of the per-frame landmark uncertainty (`propagate_uncertainty`) and
the spread across the hold. If fewer than 60% of the hold's frames pass the
quality gate, or a required landmark is not `observed`, the metric is emitted as
`unsupported` with a reason — never estimated.

### 6.1 Posture (static)

| Metric | View | Definition | Reference shown as |
|---|---|---|---|
| Head–shoulder angle (forward head proxy) | Side | Angle between the ear→shoulder line and gravity-horizontal; 90° = ear directly above shoulder. A proxy for craniovertebral angle, labelled as such (no C7 landmark). | e.g. 90° |
| Shoulder level | Front | Angle of the left→right shoulder line vs gravity-horizontal; signed, side named ("right lower by 2.6°") | 0° |
| Pelvic level (lateral) | Front | Same for the hip line | 0° |
| Knee frontal-plane angle L/R | Front | 180° − image-plane hip–knee–ankle angle, signed medial/lateral | range, e.g. 0–5° |
| Trunk lateral lean | Front | Angle between hip-midpoint→shoulder-midpoint line and gravity-vertical | 0° |

Naming: report labels use descriptive names above, not clinical terms (e.g.
"Knee frontal-plane angle", not "knee valgus"). Front-view metrics are 2D
image-plane estimates and are labelled as such.

### 6.2 Movement (per rep)

Rep boundaries come from the backend's existing deterministic
`RepCounterService`; ml-service supplies the angle series.

| Exercise | Per-rep metrics | Summary row |
|---|---|---|
| Squat | Peak knee flexion (L, R), L–R difference, rep duration | Range across reps; shallowest rep named |
| Sit-to-stand | Rep duration, peak trunk forward lean (from hip angle) | Mean ± SD duration; total time for 5 |
| Shoulder raise | Peak shoulder angle per side | L vs R difference |

The trained movement-phase checkpoint (`models/movement/*-kimore-v0.pt`) is
**not** used for any report value; rep segmentation stays deterministic.

## 7. Report

### 7.1 Record (`packages/schemas/src/assessment-report.schema.json`, new)

```
assessmentReport {
  reportId, sessionId, version: "assessment-report/v0",
  status: "draft" | "released" | "rejected",
  rows: [{
    metricKey, section: "posture" | "movement", exerciseId?, repIndex?,
    estimate: { value, unit, uncertainty } | null,
    unsupported: { reason } | null,          // exactly one of estimate/unsupported
    reference: { kind: "value"|"range", value?, min?, max?, sourceCitation,
                 referenceFileVersion, status: "draft"|"approved" } | null,
    classification: { position: "below"|"within"|"above"|"not_applicable",
                      deviation, side? },
    analysis: { text, source: "medbuddy-llm"|"medbuddy-template"|"beaive-template",
                assertions, guardResult }
  }],
  review: { reviewedBy, reviewedAt, decision, note } | null,
  provenance: { poseModelVersion, metricsVersion, referenceFileVersion,
                explanationVersion, producedAt }
}
```

Edited only in `packages/schemas/src`, regenerated with `npm run schemas:generate`.

### 7.2 Reference file (`references/posture-reference.v0-draft.json`, new)

One entry per `metricKey`: `kind`, `value` or `min/max`, `unit`,
`withinTolerance` (deviation still classed "within"), `sourceCitation`,
`status: "draft"`, `reviewedBy: null`. Schema-constrained like protocols:
`draft` forces `reviewedBy: null`.

### 7.3 Builder and text

- `ReportBuilder` (backend, pure function + tests): metrics + reference file →
  rows with classification. Deterministic; no model input.
- `ReportTemplates` (backend): one fixed sentence template per
  (metricKey, position), filled only with verdict numbers.
- `ExplanationClient`: POSTs verdict rows (no subject id, session id, or
  video) to MedBuddy; 5 s timeout.
- `ExplanationRecheck` (backend, defence in depth — runs even when MedBuddy's
  guard passed): the returned `assertions` must equal the verdict (metricKey,
  position, side, deviation rounded to 0.1); the text must contain no banned
  phrase (§3; the list lives beside `scripts/lint-claims.sh` so both use it) and
  no number absent from the verdict. Any failure → beAIve template for that row,
  recorded in `guardResult`.

### 7.4 Review and access

- `GET /reports?status=draft`, `GET /reports/:id`,
  `POST /reports/:id/review {decision, note}` — clinician JWT, audited like the
  existing review routes (`@AuditAction`).
- Released reports only are visible to the patient; PDF rendered server-side
  from the released record (same rows, same wording, Draft badges kept).
- **Open (resolve in piece 5):** the session token (piece 1) lasts 4 h, but a
  report may be released days later. Candidate: a per-report access token
  delivered at release, bound to the device's pseudonymous id.

## 8. MedBuddy `/posture/explain` (piece 4, MedBuddy repo)

- New module `src/cds/posture-explanation/` mirroring `src/cds/explanation/`:
  its own types (`PostureVerdict`, `PostureAssertions`), prompt builder,
  template provider, and a consistency guard checking assertions against the
  verdict plus the §3 banned-phrase list.
- Route `POST /cds/posture/explain`, API-key auth (existing mechanism).
  Request: `{ verdicts: PostureVerdict[] }`. Response per row:
  `{ metricKey, text, assertions, status: 'llm'|'template'|'template_fallback'|'escalated', audit_events }`.
- LLM provider injected outside `src/cds` as MedBuddy already does.
- No patient identifiers accepted; the endpoint rejects unknown fields.

## 9. Piece 1 — subject session token (from earlier design, approved)

- `POST /consent-records` (open) → `POST /sessions` validates the consent
  record (active, `derived_events` scope; `raw_video` scope required if raw
  video opt-in) and returns `{ session, sessionToken }` — JWT
  `{ sub: subjectPseudoId, sessionId, role: "subject" }`, 4 h.
- `JwtAuthGuard` + new `SessionOwnershipGuard` on every subject-facing route;
  `SessionGateway` accepts a subject token for its own session or a clinician
  token; clinician-web sends `auth: { token }` from `tokenStore.ts`.
- iOS: pseudonymous id (UUID in Keychain), consent screen (4 scopes;
  `derived_events` required), token attached to REST + Socket.IO
  (`socket.io-client-swift` via SPM), placeholders in `RootView` removed.
- First real Xcode build of `apps/ios-client`, fixing whatever it surfaces.

## 10. Build order

| # | Piece | Repos |
|---|---|---|
| 1 | iOS compiling, Socket.IO client, session token + consent | ios-client, backend, clinician-web |
| 2 | Posture + movement metrics, gravity input, reference file, report schema | ml-service, schemas, backend |
| 3 | ReportBuilder, templates, re-check, review API + clinician-web page | backend, clinician-web |
| 4 | MedBuddy `/posture/explain` + backend client | MedBuddy, backend |
| 5 | iOS guided flow + dark report screen, PDF, patient report access | ios-client, backend |

Each piece gets its own implementation plan and ships independently; pieces 2–4
are testable without the iOS app (fixture landmark streams).

## 11. Testing

- ml-service: metric functions on synthetic landmark sets with known angles,
  including tilted-gravity cases and `unsupported` paths (pytest).
- backend: ReportBuilder classification table tests; ExplanationRecheck with
  adversarial texts (grades, causes, invented numbers, flipped direction);
  review guard/audit tests in the existing lightweight style (jest).
- MedBuddy: guard tests mirroring `explanation.test.ts` (vitest).
- End-to-end: recorded fixture session → draft report → release → PDF snapshot.
- `npm run lint:claims` extended to the shared banned-phrase list.

## 12. Out of scope

Thermal measurement; any grade, diagnosis, cause, prognosis or treatment text;
using the trained movement-phase model for report values; clinician editing of
analysis text (reject + note only in v1); multi-language output.
