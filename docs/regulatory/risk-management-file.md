# Risk management file (ISO 14971-structured draft)

Source: `docs/hazard-analysis.md`, ADR-011. Extends the existing hazard
analysis toward ISO 14971 structure (severity × probability → risk level,
residual risk evaluation, verification-linked controls). **This is not a
completed ISO 14971 risk management file** — that requires a risk management
plan with a named risk manager, a cross-functional risk review, and residual
risk acceptability criteria signed off by that team, none of which exists
here (`docs/hazard-analysis.md`'s own header already said this; this
document does not change that fact, only adds structure around it).

## Severity and probability scales (draft, unreviewed)

| Severity | Definition |
|---|---|
| S1 — Negligible | No injury; inconvenience only |
| S2 — Minor | Temporary discomfort, no medical intervention needed |
| S3 — Serious | Requires medical intervention, reversible |
| S4 — Critical | Permanent harm or requires urgent intervention |

| Probability | Definition |
|---|---|
| P1 — Improbable | Would require multiple independent control failures |
| P2 — Remote | Possible only with a single control failure |
| P3 — Occasional | Plausible under normal use without a control failure |
| P4 — Frequent | Expected under normal use without the control |

**These scales and every risk-level assignment below are drafted by
engineering reasoning about what the implemented controls prevent — not
reviewed or approved by a clinical risk manager.** Real severity/probability
assignment requires clinical judgment about the population and use context,
which `docs/intended-use-matrix.md` and `study-charter-skeleton.md` mark TBD.

## Risk table

| controlId | Hazard | Severity (unmitigated) | Probability (unmitigated) | Control | Probability (residual) | Verification |
|---|---|---|---|---|---|---|
| HZ-01 | Left/right swap, identity switch | S3 | P3 | `personTrackId` + `identity_uncertain` suppression | P1 | `services/ml-service/tests/test_quality_gate.py` |
| HZ-02 | Monocular depth/scale error presented as exact | S3 | P4 (before any control — every frame is monocular) | `scaleValidated` false until real subject-specific calibration exists (ADR-008); other 3 methods unimplemented — residual risk NOT closed for those paths | P2 (subject_specific path only) | `services/ml-service/tests/test_scale_calibration.py`; residual gap documented, not closed, for `known_size_reference`/`calibrated_depth`/`stereo_multiview` |
| HZ-03 | Occluded joint scored anyway | S3 | P3 | Forced `position: null` on occlusion; quality-gate suppression | P1 | `services/ml-service/tests/test_quality_gate.py`, `test_landmark_mapper.py` |
| HZ-04 | AR anchor drift silently pooled with prior segment | S2 | P3 | New `worldAnchorId` on re-anchor; `TwoDFallbackBanner` as explicit mode | P1 (server-side); **residual risk on iOS side is UNVERIFIED**, not reduced — no Swift toolchain to test against (`apps/ios-client/README.md`) | `services/backend-api` session/camera-pose tests; iOS side has no automated verification |
| HZ-05 | Unsafe exercise cue | S4 | P3 | Deterministic-only policy engine (ADR-005); symptom report always wins regardless of ML confidence | P1 | `safety-state-machine.spec.ts`, `policy-engine.service.spec.ts` — includes an explicit test that quality-unsupported wins precedence over a simultaneous deviation signal |
| HZ-06 | Sensor artifact drives a decision | S3 | P2 (structural — `SensorsModule` never imports `SafetyService`) | Structural exclusion, not just a check | P1 | Code-level: no import exists (verified by reading the module; no test can prove a negative import as strongly as the module boundary itself) |
| HZ-07 | Risk score / clinical claim overclaim | S3 | P3 | `docs/claims-and-scope.md` + `scripts/lint-claims.sh` | P2 (lint catches code/non-doc text; does not catch every possible doc-authored overclaim) | `npm run lint:claims` (automated); manual review still required per the policy doc itself |
| HZ-08 | Cohort performance gap (device/body/lighting/skin tone) | S3 | Unknown — no evaluation dataset exists | None implemented | **Unmitigated** | None — requires Phase 4+ real evaluation data |
| HZ-09 *(new)* | Unauthorized access to subject data via the clinician review surface | S2 (privacy harm, not physical) | P4 before ADR-010 (no auth existed) | JWT auth + role check on the clinician-read REST surface; audit log of every access (ADR-010) | P2 — WebSocket gateway and device-facing endpoints remain unauthenticated (ADR-010's own named scope limit) | `jwt-auth.guard.spec.ts`, `roles.guard.spec.ts`, `audit-log.interceptor.spec.ts`; live-verified 401/200 round trip |
| HZ-10 *(new)* | Retention window stated but not enforced | S2 (privacy/data-minimization harm) | P4 (no purge job exists) | `retentionPolicy` captured on every session | **Unmitigated** — captured, not enforced (`docs/phase4/data-management-plan.md` §7) | None — no scheduled deletion job exists |

## Residual risk evaluation

Per hazard, whether residual risk is acceptable is a clinical/regulatory
judgment this repository does not make. What can be stated factually:

- **Closed or substantially reduced by a tested, structural control**:
  HZ-01, HZ-03, HZ-05, HZ-06, HZ-09 (REST surface only).
- **Partially closed, with an explicitly documented remaining gap**: HZ-02
  (only 1 of 4 methods implemented), HZ-04 (server-side only, iOS
  unverified), HZ-07 (automated lint is a partial check, not a full review),
  HZ-09 (WebSocket + device endpoints still open).
- **Not closed at all**: HZ-08 (no evaluation dataset), HZ-10 (no
  enforcement mechanism).

A real risk management file would require the risk manager to state, for
every "partially closed" and "not closed" row, whether the residual risk is
acceptable for the intended use, and if not, what further mitigation is
required before release. **That determination has not been made.**

## What this document is not

Not ISO 14971 certification or compliance evidence. Not a substitute for a
named risk manager's review. Not a claim that any row's residual risk has
been judged acceptable.
