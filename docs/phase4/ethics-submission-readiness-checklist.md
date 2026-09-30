# Ethics/IRB submission readiness checklist (Phase 4 draft)

Source: ADR-011. A checklist of what this repository has prepared vs. what
remains before an actual ethics/IRB submission is possible. **Completing
every "prepared" item below does not constitute ethics approval** — that
requires an actual ethics board reviewing an actual submission and making
an independent judgment (ADR-011's "irreducibly external" list).

## Documents prepared (this repository)

| Document | Status |
|---|---|
| Clinical investigation plan structure | Drafted, TBD fields open — `docs/phase4/clinical-investigation-plan.md` |
| Statistical analysis plan | Drafted, thresholds TBD — `docs/phase4/statistical-analysis-plan.md` |
| Safety monitoring plan | Drafted, oversight-group composition TBD — `docs/phase4/safety-monitoring-plan.md` |
| Data management plan | Drafted, retention enforcement gap flagged — `docs/phase4/data-management-plan.md` |
| Informed consent template | Unreviewed draft — `docs/phase4/informed-consent-template.md` |
| Hazard analysis / risk management file | Real, implemented controls documented — `docs/hazard-analysis.md`, `docs/regulatory/risk-management-file.md` |
| Intended-use matrix | Draft scaffold — `docs/intended-use-matrix.md` |

## Software readiness supporting the above

| Capability | Status |
|---|---|
| Real-time symptom-stop, safety-precedence-enforced | Implemented, tested (`safety-state-machine.spec.ts`) |
| Structured adverse-event documentation | Implemented, tested (`adverse-events.service.spec.ts`) |
| De-identified, consent-gated research export | Implemented, tested (`research-export.service.spec.ts`) |
| Aggregate safety-monitoring metrics | Implemented, tested (`pilot-metrics.service.spec.ts`) |
| Technical-feasibility statistics tooling | Implemented, tested against synthetic data (`test_technical_feasibility.py`) |
| Sample-size calculators | Implemented, tested (`test_sample_size.py`) |
| Clinician authentication + audit logging | Implemented, tested (ADR-010) |

## What must happen before submission — none of this is done

1. **Named clinical lead and biostatistician** assigned, and every TBD field
   in `docs/phase4/clinical-investigation-plan.md` and
   `docs/phase4/statistical-analysis-plan.md` filled by them.
2. **Legal/ethics review of the informed consent template** — currently
   unreviewed by anyone.
3. **Site and reference-instrument arrangements** for Study A (TRD §3.2) —
   not arranged; this repository has no relationship with any clinical site.
4. **Retention-enforcement gap resolved or operationally worked around**
   (`docs/phase4/data-management-plan.md` §7) — a real ethics board will
   ask how the stated retention period is actually enforced; today's honest
   answer is "captured but not automatically purged."
5. **Data safety/clinical oversight group formed**, with actual stop
   criteria set (`docs/phase4/safety-monitoring-plan.md`) — the software
   gives them tooling, not a decision.
6. **Jurisdiction and ethics body identified** — `docs/study-charter-skeleton.md`
   references Malaysia MDA as an example only, not a decision.
7. **Submission package assembled** in the target ethics body's actual
   required format — this repository's documents are content, not a
   formatted submission.
8. **The actual submission**, and the ethics board's actual review and
   decision — cannot happen without items 1–7, and cannot be done by this
   repository at all.

## What this document is not

Not evidence that any of the above has happened. Not an ethics approval,
draft approval, or conditional approval of any kind.
