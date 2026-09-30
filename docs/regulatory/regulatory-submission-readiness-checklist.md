# Regulatory submission readiness checklist (Phase 5 draft)

Source: ADR-011, TRD §3.3. The master checklist tying together every Phase 5
document and the software behind it. **Completing every "prepared" row does
not constitute regulatory clearance or approval** — that requires an actual
regulatory body reviewing an actual submission (ADR-011's "irreducibly
external" list).

## Documents prepared (this repository)

| Document | Status | Depends on |
|---|---|---|
| Risk management file | ISO 14971-structured draft; residual risk NOT evaluated for acceptability | `docs/hazard-analysis.md`, real hazard controls |
| Software lifecycle (IEC 62304) | Draft mapping; safety classification not risk-team-reviewed | Real ADRs, real test suites |
| Usability engineering file (IEC 62366) | Skeleton; no formative/summative evaluation performed | Real UI safety elements (SymptomStopButton, quality banners, etc.) |
| Cybersecurity documentation | Draft threat model; no scan or pentest performed | Real SBOMs, real auth implementation (ADR-010) |
| Verification & validation report | Real test-count evidence (197 tests, 4 suites); no formal V&V plan preceded the tests | Actually-passing test suites |
| Device classification analysis | Reasoned analysis; jurisdiction and final classification undecided | `docs/claims-and-scope.md`'s claims ladder |
| Labeling / IFU draft | Unreviewed draft | `docs/claims-and-scope.md`, `docs/intended-use-matrix.md` |
| SBOM + process | Real, generated; Python one has a documented scoping caveat | `scripts/generate-sbom.sh` |

## Software capabilities supporting a submission

| Capability | Status |
|---|---|
| Traceable provenance on every record | Implemented (`common.schema.json#/$defs/provenance`) |
| Schema-enforced data contracts | Implemented, contract-tested (11 tests) |
| Deterministic, auditable safety decisions | Implemented, tested (ADR-005) |
| Clinician authentication + access audit trail | Implemented, tested, live-verified (ADR-010) |
| De-identified research export | Implemented, tested |
| Adverse event documentation | Implemented, tested |
| Aggregate safety monitoring | Implemented, tested |

## What must happen before any real submission — none of this is done

1. **A named regulatory affairs professional** reviews every document above
   and either affirms or corrects its analysis — none of it has been
   reviewed by anyone but the engineering process that produced it.
2. **Target jurisdiction decided** — `docs/study-charter-skeleton.md` and
   `docs/regulatory/device-classification-analysis.md` both leave this open.
3. **Clinical evidence from Study A/B/C** (`docs/phase4/`) — a regulatory
   submission for anything beyond the lowest-risk SaMD categories typically
   requires clinical evidence; none exists yet, and Phase 4 itself requires
   ethics approval and real patients first.
4. **Residual risk acceptability determination** by a qualified risk
   manager (`docs/regulatory/risk-management-file.md` lists several rows
   explicitly NOT closed — HZ-08, HZ-10, and partial closure on HZ-02/04/07/09).
5. **Formative/summative usability evaluation** with real users
   (`docs/regulatory/usability-engineering-file.md`) — not performed.
6. **Security scan and/or penetration test** against the SBOMs
   (`docs/regulatory/sbom-process.md`, `docs/regulatory/cybersecurity-documentation.md`)
   — not performed.
7. **Quality management system** (e.g. ISO 13485) the submission would be
   made under — this repository has git history and ADRs, which is real
   design-control evidence, but no formal QMS (document control numbering,
   CAPA process, management review cadence) wraps it.
8. **Production-grade security** (TLS, encryption at rest, device/subject
   authentication, WebSocket authentication) — every one of these is a
   named, open gap (`docs/regulatory/cybersecurity-documentation.md`).
9. **The actual submission**, and the regulator's actual review — cannot
   happen without items 1–8, and cannot be done by this repository at all.

## Relationship to Phase 4

Items 3–5 above substantially overlap with Phase 4
(`docs/phase4/ethics-submission-readiness-checklist.md`). A real regulatory
strategy will likely sequence Phase 4's clinical evidence generation before
a Phase 5 submission is possible at all, for anything above the lowest SaMD
risk category — this is itself a strategic decision for the regulatory
affairs professional in item 1, not decided here.

## What this document is not

Not evidence that any regulatory body has been contacted. Not a submission.
Not a claim that this system is close to market-ready — the honest count is
9 unstarted external-dependent items above a real, but partial, engineering
foundation.
