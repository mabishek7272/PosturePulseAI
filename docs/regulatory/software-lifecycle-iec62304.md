# Software lifecycle (IEC 62304-structured draft)

Source: ADR-011, `study-charter-skeleton.md`'s "IEC 62304 software-lifecycle
scope: TBD". Maps this repository's actual engineering practice to IEC
62304 activities — a mapping exercise, not a certified or audited SDLC.

## Software safety classification (draft, unreviewed)

IEC 62304 classifies software by the severity of harm it could contribute to
(Class A: no injury possible: Class B: non-serious injury possible; Class C:
death or serious injury possible). **Classification is normally a risk-based
determination made with the risk management file above, by a qualified
team — the assignment below is engineering reasoning about what each
component structurally can and cannot do, not that determination.**

| Component | Draft class | Rationale |
|---|---|---|
| `services/backend-api/src/safety/` (safety FSM) | C (candidate) | Directly gates whether a session may continue; symptom-report precedence is safety-critical |
| `services/backend-api/src/policy/` (policy engine) | C (candidate) | Only path that can emit `cue`/`escalate_review` — deterministic by design (ADR-005) specifically because of this classification concern |
| `services/ml-service/app/quality/` (quality gate) | C (candidate) | Its `unsupported` determination is what the policy engine's precedence rule depends on |
| `services/ml-service/app/geometry/` (kinematics, scale) | B (candidate) | Feeds the policy engine but is not itself the safety decision point |
| `services/ml-service/app/movement/` (ST-GCN/TCN) | A (candidate) | Structurally excluded from any safety decision (ADR-005) — `validated: false` always, never imported by `SafetyService`/`PolicyModule` |
| `services/ml-service/app/detection/` (object detection) | A (candidate) | Descriptive only, no safety coupling (ADR-006) |
| `apps/clinician-web` | A (candidate) | Read-only review surface; never issues a safety-relevant instruction back to a session |
| `apps/ios-client` | B/C (candidate, **unverified**) | Runs the local symptom-stop path (safety-relevant) but no on-device inference; classification needs the same clinical review as above, and the code itself has never been compiled or tested (no Swift toolchain — `apps/ios-client/README.md`) |

## Development process, mapped to what actually happens in this repository

| IEC 62304 activity | This repository's practice |
|---|---|
| Software development planning | ADRs (`docs/adr/`) document each significant design decision as it's made, including scope boundaries and rejected alternatives — not a single up-front plan, but a real, dated decision record |
| Requirements analysis | `packages/schemas/src/*.schema.json` is the canonical, versioned data-contract source of truth (ADR-002); `docs/traceability-matrix.md` maps schema/model/protocol versions to hazard controls |
| Architectural design | `README.md`'s architecture section; `docs/coordinate-frames.md` for the spatial-reasoning design |
| Detailed design | In-code documentation at decision points (e.g. every safety-relevant function's own doc comment explaining *why*, not just *what*) |
| Unit implementation and verification | Real, executed test suites — see `docs/regulatory/verification-validation-report.md` for current counts (not mocked-away; e.g. the ml-service pose pipeline runs real MediaPipe inference in its tests, not a stub) |
| Integration and integration testing | Live cross-service round trips performed and recorded during development (real curl/browser verification against actually-running services), though not currently captured as an automated integration test suite — see `docs/regulatory/verification-validation-report.md`'s "what is not yet automated" section |
| System testing | Not performed — requires a complete, deployed system and defined system-level test cases, neither of which exists yet |
| Software release | No formal release process exists — every commit lands on a single branch; no versioned, signed release artifact is produced |
| Problem resolution | GitHub issue/PR workflow is available to the repository but no formal CAPA (corrective and preventive action) process is defined — see `docs/regulatory/regulatory-submission-readiness-checklist.md` |

## SOUP (software of unknown provenance) — third-party components

Enumerated in the SBOMs (`docs/regulatory/sbom/`, `docs/regulatory/sbom-process.md`).
IEC 62304 requires SOUP items relevant to safety-classified software to have
documented known anomalies and a risk assessment for their use — **not done
here**. The safety-critical components (Class C candidates above) depend on:
`@nestjs/*`, `xstate` (backend-api safety FSM), `mediapipe`/`opencv-python`
(ml-service pose pipeline). A real SOUP assessment would review each of
these for known defects relevant to this use, which requires the vulnerability
scan named as a follow-up in `docs/regulatory/sbom-process.md`.

## What this document is not

Not a certified IEC 62304 process. Not a claim that any safety
classification above has been through the actual risk-based determination
the standard requires. Not evidence of a functioning CAPA or configuration
management process beyond what git itself provides.
