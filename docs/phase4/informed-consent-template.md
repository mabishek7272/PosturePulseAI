# Informed consent form — draft template

Source: beAIve PRD §1.6, TRD §3.2, `docs/consent-and-retention.md`,
`docs/claims-and-scope.md`, ADR-011.

**This is an unreviewed draft template.** It has not been reviewed by legal
counsel, a clinical lead, or an ethics board, and **must not be presented to
any real participant** until it has. Every `[bracketed]` field is a
placeholder. The prose outside brackets follows this repository's claims
policy (`docs/claims-and-scope.md`) — it may need revision for the specific
study, jurisdiction, and population, but should not be loosened to overclaim
what the system does without also revisiting that policy.

---

## Study title

[TBD — from `docs/phase4/clinical-investigation-plan.md`]

## Invitation and purpose

You are invited to take part in a research study about a posture/movement
assessment system called beAIve. This study is being done to find out
[TBD: Study A/B/C-specific purpose, in plain language]. Nothing about this
system has been medically validated yet — that is what this study is for.

## What the system does and does not do

- It uses your device's camera to estimate the angles of your joints and how
  you move during specific exercises. It does **not** diagnose any condition,
  measure your pain or fatigue directly, or predict future injury.
- If it cannot get a clear enough view to make an estimate, it will say so
  rather than guess.
- [TBD: study-specific description of what data collection actually involves
  — camera use, wearable sensor if any, duration, location]

## What you will be asked to do

[TBD: session count, duration, setting, exercises, any reference-instrument
measurement for Study A]

## Risks

[TBD (clinical lead) — physical risks of the exercises themselves;
risks specific to the study procedures, e.g. reference-instrument
attachment if any]. You can stop at any time, for any reason, by
[describing the symptom-stop mechanism in participant-facing language —
TBD]. Stopping will not affect [TBD: care you otherwise receive].

## Benefits

[TBD (clinical lead) — do not overstate; per `docs/claims-and-scope.md`, no
claim above the evidence level this study itself will produce is permitted
here, including in a benefits section].

## Your data

- We will record: [derived measurements — joint angles, quality flags,
  session events]. [If raw video opt-in is offered for this study: describe
  separately, with its own retention window —
  `docs/consent-and-retention.md`.]
- Your data will be linked to a code, not your name — see
  `docs/consent-and-retention.md`'s pseudonymous-identifier design.
- [If applicable] With your separate consent, de-identified data from your
  sessions may be included in a research export for statistical analysis
  (`services/backend-api/src/research-export/` — this is a real, enforced
  consent gate in the software, not just a policy statement).
- Your data will be kept for [TBD: retention period —
  `docs/phase4/data-management-plan.md` §7 notes retention enforcement is
  not yet automated in the software; a real study must state and actually
  enforce a period before enrollment].
- You can withdraw your consent at any time. [TBD (legal): what happens to
  already-collected data on withdrawal — `docs/phase4/data-management-plan.md`
  §8 flags this as an open software gap that must be resolved or worked
  around operationally before this study begins.]

## Who to contact

[TBD: study coordinator, ethics board contact, emergency contact]

## Consent

I have read and understood the above. I am taking part voluntarily and can
withdraw at any time without giving a reason.

[Signature block — TBD, format per site/jurisdiction requirements]

---

## Notes for the clinical lead / ethics board (remove before use)

- Every risk, benefit, and data-retention statement above needs your
  specific input — this template intentionally leaves them blank rather
  than guessing.
- The "what the system does and does not do" section is drawn directly from
  `docs/claims-and-scope.md`'s hard boundary and claims ladder — please
  flag if study-specific language drifts from that policy rather than
  silently loosening it.
- This template assumes a single study; if Study A/B/C use materially
  different procedures, they likely need separate consent forms.
