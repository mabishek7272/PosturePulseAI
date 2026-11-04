# DRAFT consent copy for the multi-block protocol

> **Status: DRAFT. NOT REVIEWED. Do not paste into the app.**
>
> `apps/mobile/src/app/consent.tsx` carries the comment *"Reviewed consent copy - word-for-word,
> split only at existing sentence boundaries."* That reviewed text must not be edited in
> place by an unreviewed change, or unreviewed wording would inherit the reviewed label.
> This file is the proposed replacement, for the clinical lead to accept, amend or reject.
> Only after sign-off should `CONSENT_POINTS` be changed, in a commit that does nothing else.

## Why the reviewed copy no longer describes the assessment

The first reviewed point says **"four standing poses"**. Three changes break that:

1. **The multi-block protocol** replaces the single hold per view with a relaxed hold, a
   habitual stance captured after marching in place, and an AR-standardised stance. The
   count and the nature of the captures both change.
2. **Balance manoeuvres** (eyes-closed standing, single-leg stance) are a different kind of
   request: they carry a physical risk of losing balance that standing still does not.
   `docs/hazard-analysis.md` HZ-09 records this as the only hazard in that table directed at
   the patient's body rather than at the measurement. Consent that describes "standing poses"
   does not cover being asked to stand on one leg with eyes closed.
3. **Depth recording** (ADR-020) adds a second recording alongside the video — a distance
   map from the iPad's depth sensor. It contains no new identifiers, but it is a recording of
   the person and the reviewed copy does not mention it.

Points 2, 3 and 4 of the reviewed copy remain accurate and are proposed unchanged.

## Current reviewed copy, verbatim (for comparison)

1. "Short video clips of four standing poses will be recorded and uploaded to this clinic's
   server, where body landmarks are measured."
2. "Video is not retained after measurement."
3. "Measurements are camera-based estimates reviewed by a clinician, and are not a
   substitute for clinical examination."
4. "The recording can be stopped at any time, and the assessment can be ended on request."

## Proposed replacement

1. "Short video clips of several standing positions will be recorded and uploaded to this
   clinic's server, where body landmarks are measured."
2. "The iPad also records a distance map from its depth sensor alongside each clip. It
   measures how far away each part of the body is. It contains no name, face recognition or
   other identifying information."
3. "Some positions involve standing with eyes closed or on one leg. A member of staff will
   stay within arm's reach for these. Tell them if you feel unsteady at any point and they
   will stop."
4. "Video and depth recordings are not retained after measurement."
5. "Measurements are camera-based estimates reviewed by a clinician, and are not a
   substitute for clinical examination."
6. "The recording can be stopped at any time, and the assessment can be ended on request."

## What changed, and why

| # | Change | Reason |
|---|---|---|
| 1 | "four standing poses" → "several standing positions" | The protocol no longer has a fixed count of four. "Positions" rather than "poses" because a habitual stance after marching is not a pose the patient holds deliberately. Deliberately avoids naming a number, so the copy does not need re-review each time the battery changes |
| 2 | New | A depth recording is a new recording of the person. Says what it measures in plain terms and states what it does not contain, because "depth sensor" invites the assumption of something more invasive |
| 3 | New | HZ-09. States the physical risk, names the mitigation (staff within arm's reach), and tells the patient they can stop it. This is the consent counterpart of the pre-execution spotter gate; neither substitutes for the other |
| 4 | "Video is not retained" → "Video and depth recordings are not retained" | Keeps the retention statement true once a second recording exists |
| 5–6 | Unchanged from reviewed points 3 and 4 | Still accurate; carried over word-for-word so the clinical lead reviews only what changed |

## Open questions for the clinical lead

1. **Is point 3 sufficient, or does a balance manoeuvre need its own separate attestation?**
   The current flow is one checkbox plus one signature covering all points. A fall risk may
   warrant a distinct tick rather than being bundled with the rest.
2. **Should the patient be able to decline the balance block but proceed with the static
   captures?** The consent record has no per-step structure today — `scopes` is a flat enum
   of four retention categories (`derived_events`, `raw_video`, `research_data_export`,
   `wearable_integration`) with no protocol or step binding. Per-manoeuvre refusal would
   need a schema change, not just copy.
3. **Does the clinic want a fall-risk screening question before the balance block is
   offered at all?** `protocols/sit-to-stand.v0-draft.json` already scopes itself to
   patients with "low fall risk"; the static battery has no equivalent gate.

## Note on a separate consent blocker (not addressed by this draft)

The clinician loupe in Phase 5 needs the keyframe, so it needs `raw_video` scope. The live
flow hardcodes `scopes: ["derived_events"]` (`apps/mobile/src/api/sessions.ts`), so
`analysis-job-runner.ts` deletes every clip after analysis and `raw_video` is never granted.
That is a separate decision — it changes what is *kept*, not what is *described* — and
needs its own reviewed copy. Deliberately out of scope here, and the proposed point 4 above
assumes retention is unchanged.
