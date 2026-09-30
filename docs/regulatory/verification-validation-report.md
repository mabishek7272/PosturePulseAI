# Verification & validation report (draft)

Source: ADR-011. Reports this repository's actual, current, real (not
fabricated) automated test evidence — this is **software verification**
(does the system do what it was designed to do) for engineering scaffolding,
**not clinical validation** (does it produce clinically accurate or
effective results — that is Study A/B/C, `docs/phase4/`, and has not
happened).

## Automated test evidence (current, as of this report)

| Suite | Count | What it covers |
|---|---|---|
| `packages/schemas` contract tests | 11 | Raw-schema business rules Ajv enforces at runtime for every canonical record type, including the new `adverse-event-record` schema |
| `services/backend-api` (Jest) | 77 | Safety FSM, policy engine (including the precedence test: quality-unsupported wins over a simultaneous deviation signal), auth/audit, consent, exposure, movement-buffer isolation, adverse events, research export, pilot metrics |
| `services/ml-service` (pytest) | 63 | Real MediaPipe pose inference (not mocked), quality gating, kinematics, scale calibration, object detection (real torchvision inference), movement-window orchestration, technical-feasibility statistics, sample-size calculators |
| `apps/clinician-web` (Vitest) | 46 | Auth flow (login/logout/token expiry), every page's data-loading and error states, audit-log/pilot-metrics/adverse-events views |
| **Total** | **197** | |

All four suites pass as of this document. Re-run with: `npm run schemas:check`
(from `packages/schemas`, actually `npm test`), `npm run backend:test`,
`cd services/ml-service && pytest`, `npm run web:test`.

## What "passing" actually verifies

- **Real inference, not stubs**: the ml-service pose and object-detection
  tests run actual model inference (MediaPipe PoseLandmarker, torchvision
  Faster R-CNN) against real or synthetic images — a broken model load, a
  changed output shape, or a wrong coordinate transform would fail these
  tests, not just a mocked assertion.
- **Real DI graph boots**: multiple points in this project's history
  (documented in commit messages and ADRs) caught circular-dependency and
  DI-resolution bugs that `tsc` alone did not catch, by actually booting the
  NestJS application — this is standard practice here, not a one-off.
- **Live cross-service verification performed during development**
  (not itself an automated suite): curl-based and headless-browser round
  trips against the actually-running backend-api + ml-service + clinician-web,
  covering login, consent-gated research export, adverse-event creation,
  pilot-metrics computation, and the full session lifecycle. These were
  performed and observed correct during this repository's development but
  are **not captured as a repeatable, automated integration test** — a real
  V&V process should promote these into CI-run integration tests rather
  than relying on developer-performed spot checks.

## What is NOT verified

- **No end-to-end system test** exists as an automated, CI-run suite
  spanning all three services plus a real device.
- **No load, performance, or stress testing.**
- **No iOS testing at all** — the code has never been compiled (no Swift
  toolchain in this repository's environment); see `apps/ios-client/README.md`.
- **No accuracy validation against a reference instrument** — that is Study
  A (`docs/phase4/statistical-analysis-plan.md`), which needs real paired
  data that does not exist.
- **No security testing** beyond the threat-model reasoning in
  `docs/regulatory/cybersecurity-documentation.md` — no penetration test,
  no fuzzing, no dependency vulnerability scan.
- **No regression test suite tied to a formal requirements traceability
  matrix** with sign-off — `docs/traceability-matrix.md` exists and is
  real, but is maintained manually, not generated from a requirements
  management tool with formal linkage.

## Traceability

`docs/traceability-matrix.md` maps each canonical schema to its model/adapter
version and the hazard control(s) it satisfies. `docs/regulatory/risk-management-file.md`
maps each hazard control to the specific test file(s) that verify it. Neither
matrix is generated or checked by tooling — both are manually maintained and
could drift from the code without a build failure signaling it.

## What this document is not

Not evidence of clinical validation. Not a formal V&V plan with predefined
pass/fail acceptance criteria signed off before testing began (these tests
were written alongside the code, in the normal course of development, not
against a pre-agreed V&V protocol). Not a claim that 197 passing tests
means the system is ready for real subject data — see
`docs/regulatory/regulatory-submission-readiness-checklist.md` for what
else that would require.
