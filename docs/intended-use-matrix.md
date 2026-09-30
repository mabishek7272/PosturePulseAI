# Intended-use matrix

Source: beAIve PRD §1.1, §4.6. This matrix must be reviewed and formally approved
by a clinical lead and regulatory owner before any recruitment or marketing — it is
a **draft scaffold** using the PRD's own recommended defaults, not a decided
intended-use statement.

## Deployment contexts in scope for this phase

| Deployment context | Description | Claim boundary today |
|---|---|---|
| `clinic_supervised` | Physiotherapist/posturologist runs or directly supervises the session in a clinical setting. | Observational/estimated movement feedback only; see `docs/claims-and-scope.md` claims ladder — currently below Level A (no validation study completed). |
| `home_rehab` | Patient performs a clinician-prescribed protocol at home, unsupervised in the moment, with clinician review of session history. | Same claim boundary; additionally requires the local-first symptom-stop path (`apps/ios-client/Sources/Safety/SymptomStopButton.swift`) since no clinician is present to intervene live. |

Both are recorded on every `Session` via `deploymentContext` and on every
`ProtocolDefinition` via `deploymentContext[]`.

## Deployment contexts explicitly NOT in scope for this phase

- Office/industrial ergonomics (PRD §1.1 secondary workflow) — different
  measurement/claim needs (RULA/REBA-assisted review), Phase 1/2 per the PRD's own
  phase table, not built here.
- Neurological, elderly-care, or orthopedic-outcome tracks — PRD explicitly gates
  these as "distinct evidence tracks" with separately gated claims (PRD, design
  decision note at top of document). Nothing in this repo should be described as
  supporting these until that gating work happens.

## What the system does / does not claim, by context

| | Does | Does not (yet) |
|---|---|---|
| Both contexts | Estimated joint angles with uncertainty; rep/hold counts; quality-gate suppression when unsupported; symptom-triggered pause | Diagnosis; validated accuracy claim; autonomous safety determination; treatment prescription |

## Decisions still owned by product/clinical leads (PRD §4.6) — not decided by this codebase

1. The exact first 2–3 exercises and target population (this repo ships 3
   **draft, unvalidated** placeholders — see `protocols/*.json` — as a structural
   starting point, not a clinical decision).
2. Whether a validated wearable is required for the first indication (PRD default:
   optional research integration; symptom entry mandatory regardless — reflected in
   `consent-record.schema.json`'s `wearable_integration` scope being separate from
   the mandatory `symptom-report` path).
3. Jurisdiction and exact wording of the first intended-use statement before any
   clinical recruitment or marketing (TRD §3.3: Malaysia MDA classification
   determination referenced as an example, not assumed decided).
