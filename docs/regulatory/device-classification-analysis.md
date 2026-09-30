# Device classification analysis (draft)

Source: ADR-011, TRD §3.3, `docs/study-charter-skeleton.md`'s "Regulatory
gate" section. **An analysis, not a determination.** Device classification
is a jurisdiction-specific regulatory decision made by (or in consultation
with) the actual regulatory body — this document reasons through the
relevant frameworks using this system's actual, current claim level, so a
regulatory affairs professional has a starting analysis rather than a blank
page.

## Is this Software as a Medical Device (SaMD) at all?

Under most jurisdictions' frameworks (IMDRF's SaMD definition is the most
widely referenced), software qualifies as SaMD when it is intended for one
or more medical purposes without being part of a hardware device. beAIve's
current, evidenced claim level is **Level A** on its own claims ladder
(`docs/claims-and-scope.md`): "estimated joint angle during task X, with
uncertainty" — an observational/technical measurement, not a diagnostic,
therapeutic, or risk-prediction claim. **Whether Level A framing alone
qualifies as a "medical purpose" is itself jurisdiction-dependent** — some
regulators treat any posture/movement feedback intended for use in a
clinical care pathway as SaMD regardless of claim modesty; others reserve
that determination for claims at or above Level B/C. This is the first
open question a regulatory affairs professional must resolve, and this
document does not resolve it.

## IMDRF risk categorization (if SaMD)

The IMDRF framework categorizes SaMD by two axes: the significance of the
information the software provides to a healthcare decision, and the state
of the healthcare situation/condition.

| Axis | This system's current, evidenced state |
|---|---|
| Significance of information | **"Informs clinical management"** — the system provides observational measurements (angles, exposure buckets, quality flags) for a clinician to consider; it does not "drive" (autonomously recommend a specific action without clinician judgment) or "treat/diagnose" anything. The deterministic policy engine's `cue` action is a clinician-configured rule notification, not an autonomous treatment decision (ADR-005) — this distinction matters and should be reviewed carefully, since a regulator may view any automated cue differently than passive display. |
| State of healthcare situation | **TBD (clinical lead)** — depends on the actual target population and condition (`docs/intended-use-matrix.md`). Likely "non-serious" for the currently-scoped `clinic_supervised`/`home_rehab` posture-exercise contexts, but this is not decided. |

Under the IMDRF matrix, "informs clinical management" × "non-serious
situation" is typically the lowest SaMD risk category (Category I). This is
a **plausible outcome given the current claim level**, not a classification
this repository asserts.

**This classification is fragile to claim creep.** If the system's claims
ever move up the claims ladder (Level B "task-level assessment" or higher —
`docs/claims-and-scope.md`) without a corresponding re-analysis, the
classification analysis above no longer holds. Any product/marketing
decision to add a claim must trigger a re-read of this document, not just
`docs/claims-and-scope.md`'s lint check.

## Jurisdiction-specific notes

- **Malaysia MDA**: referenced in `docs/study-charter-skeleton.md` as an
  *example*, not a decision. Product-classification determination is a
  formal MDA process this repository has not initiated.
- **US FDA**: FDA's own SaMD/Clinical Decision Support guidance and its
  "low-risk general wellness" carve-out are both potentially relevant
  depending on final claims and intended use — neither has been evaluated
  in depth here.
- **EU MDR**: Rule 11 (software) classification depends similarly on
  intended purpose and risk to the patient — not evaluated in depth here.

**Target market has not been decided** (`docs/study-charter-skeleton.md`).
This document does not pick one.

## What would change this analysis

- Any claim at Level B or above (`docs/claims-and-scope.md`).
- A target population with a "serious" or "critical" healthcare situation
  (e.g. post-surgical rehabilitation with fall risk, vs. general posture
  awareness).
- The system driving an automated action without clinician review (not
  current behavior — the policy engine's `cue` is a notification within a
  clinician-supervised or clinician-prescribed context, never an autonomous
  treatment change).
- Any physiological-sensor-driven alert (PRD §4.6 explicitly defaults this
  to optional research integration, not an alerting function — see
  `sensor-reading.schema.json` and `SensorsModule`'s structural exclusion
  from `SafetyService`).

## What this document is not

Not a classification determination. Not legal or regulatory advice. Not a
substitute for engaging an actual regulatory affairs professional and the
actual target jurisdiction's regulatory body.
