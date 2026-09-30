# Study charter — skeleton

Source: beAIve TRD §3.2 ("Validation protocol and prespecified measures"), §3.3.
**This is a placeholder structure only.** Every section below is marked TBD and
must be filled in by the clinical lead, study coordinator, and regulatory owner
before any enrollment. Do not fill these in speculatively from this codebase.

## Study A — technical feasibility

- Population / inclusion-exclusion criteria: **TBD (clinical lead)**
- Devices / lighting / clothing / mobility strata to cover: **TBD**
- Reference instrument (calibrated optical motion capture or goniometry): **TBD**
- Primary measures: absolute angle error (median/95th pct), Bland–Altman limits,
  valid-sample rate, time-sync/failure-detection sensitivity — **methodology fixed
  by TRD §3.2, but task- and claim-specific pass/fail limits must be set before
  enrollment, by clinical investigators. TBD.**

## Study B — clinical/ergonomic agreement

- Locked indication(s) and population(s): **TBD**
- Independent blinded adjudicators (physiotherapists/ergonomists): **TBD (names/
  qualifications)**
- Primary metrics: sensitivity for predefined unsafe-movement events, specificity,
  event-level precision/recall, calibration/abstention, subgroup gaps, test–retest
  — **fixed by TRD §3.2; thresholds TBD.**
- Held-out external site: **TBD**

## Study C — supervised effectiveness and harm

- Comparator (standard care vs. beAIve-supported feedback): **TBD**
- Primary endpoint: **TBD**
- Data safety/clinical oversight group composition and stop criteria: **TBD**
- Ethics approval body and consent process: **TBD** — note per TRD §3.2: the
  existing beAIve DengueSense protocol and its approvals, if any, **must not be
  presumed to cover this distinct posture study.**

## Physiological substudy (if a wearable is used)

- Sensor model, validation status, sampling rate, wear location: **TBD** — PRD
  §4.6 default: optional research integration; no heart-rate-based alert without a
  clinical protocol and sensor validation.

## Therapeutic side-effect protocol

- Solicited symptom list, severity scale, time-to-onset windows, escalation
  timelines, adjudication process, follow-up interval: **TBD**

## Regulatory gate (TRD §3.3)

- Target market(s) and classification pathway (e.g. Malaysia MDA product-
  classification determination): **TBD**
- ISO 14971 risk management file owner: **TBD**
- IEC 62304 software-lifecycle scope: **TBD**

---

Nothing above is decided by this repository. Its only job here is to exist as a
fixed structure so the clinical/regulatory team has a known place to put answers,
and so engineering work never silently assumes an answer that hasn't been given.
