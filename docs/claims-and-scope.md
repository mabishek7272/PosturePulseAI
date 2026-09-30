# Claims and scope policy

Source: beAIve PRD §0 ("Hard boundary"), §1.1, §1.6 ("Claim release rule"); TRD §3.1
("Claims ladder"). This is the authoritative list for `scripts/lint-claims.sh` and for
manual review of anything user-facing.

## The hard boundary

Body pose and workspace video **estimate visible geometry and exposure**. They do
**not** directly measure spinal curvature, tissue loading, pain, muscle fatigue,
tremor diagnosis, or future injury. Physiological measurements require suitable
connected sensors or participant report — never a video-inferred substitute.

## Prohibited language, anywhere outside `docs/`

Do not use, in code, UI copy, sample data, commit messages, or non-`docs/`
documentation:

- Any word implying **diagnosis** ("diagnose", "diagnosis", "diagnostic result").
- **"Clinically validated"** or **"medically accurate"** applied to this system's
  current output. Nothing in this repository has been clinically validated (see
  `protocols/*.json`, all `status: "draft"`).
- **"Medically safe"** as a claim the system makes about a movement or exercise.
- Any claim that the system **cures**, **treats**, or **prevents** a disease or
  injury (e.g. "prevents WMSD", "treats back pain").
- A **numeric score presented as medically meaningful** (e.g. a 0–100 "posture
  score" implied to correlate with health outcomes). Estimated angles and quality
  flags are fine; an unvalidated composite score is not.

`scripts/lint-claims.sh` greps for a subset of this list as a cheap first pass. It
is not a substitute for reading this document and reviewing the actual copy.

## The claims ladder (TRD §3.1) — what's allowed once evidence exists

| Level | Allowed after evidence | This repo today |
|---|---|---|
| A: technical measurement | "Estimated knee flexion during task X, with uncertainty" | This is the target for Phase 1 (`CalibratedJointFrame`) — not yet evidenced by a validation study. |
| B: task-level assessment | "Performed 8 observable repetitions; 2 had pattern Y" | Not yet built. |
| C: ergonomic exposure | "Observed neck flexion and reach exposure during sampled task" | Deferred (Phase 2+). |
| D: therapeutic feedback safety/effectiveness | "Improves performance of prescribed task without unacceptable adverse events" | Deferred; requires Study C (TRD §3.2). |
| E: disease or prevention claim | "Detects neurological progression / prevents WMSD" | Explicitly out of scope; separate regulatory track. |

Nothing in this repository claims above Level A, and even Level A claims require a
completed technical feasibility study (Study A) before release — not just passing
software tests. **Passing latency/tracking tests does not authorize a therapeutic or
preventive claim.**

## Protocol data discipline

Every file in `protocols/*.json` is schema-constrained (see
`packages/schemas/src/protocol-definition.schema.json`): `status: "draft"` forces
`clinicallyValidated: false` and `reviewedBy: null`. Do not hand-edit these fields to
make a protocol appear reviewed — that requires an actual clinical-lead sign-off
process this repository does not yet implement.

## Reviewing a change against this policy

Before merging anything that touches UI copy, protocol data, sample output, or docs
aimed at a non-engineering audience:

1. Run `npm run lint:claims`.
2. Read the diff and ask: could a clinician, patient, or regulator reasonably read
   this as a diagnosis, a validated accuracy claim, or a therapeutic promise? If
   yes, rewrite it as an estimate with stated uncertainty and source, per PRD §1.3
   ("Show estimated values, uncertainty, source, and clinical status separately").
