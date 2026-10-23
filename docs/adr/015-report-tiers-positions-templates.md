# ADR-015: Measurement tiers, positions, reference kinds and report templates

## Status
Accepted (M1). Draft data: the reference set and the battery carry
`"status": "draft"` until a clinical lead signs them off; this ADR does not
change that.

## Context
A report row has to say what was measured, how far to trust it and how it sits
against a reference, without implying a diagnosis, a validated accuracy, a
grade or a composite score (`docs/claims-and-scope.md`).

## Decision
**Tiers** (`metric-result.schema.json`):
- `estimate`: a quantity the 2D pipeline measures directly, with an uncertainty.
- `proxy`: a quantity that describes landmark geometry only (for example the
  angle of the line between two shoulder landmarks). Shown with the suffix
  "Proxy measurement: describes landmark geometry only."
- `entered` / `annotated`: reserved for values a person types or marks.
- `not_measurable`: things this system cannot measure (listed in the catalog and
  always shown in the report).
Every requested metric yields exactly one result per side: an `estimate`, or an
`unsupported` result with quality reasons. Nothing is omitted or guessed.

**Reference kinds** (`reference-range-set.schema.json`):
- `geometric`: a geometric fact (for example 0 degrees for a level line).
- `literature`: a published range, with its citation.
A proxy may only have a `geometric` reference. The builder checks this when the
reference set is indexed and fails the build otherwise. A reference whose unit
differs from the metric's unit, or that names a metric the ml-service catalog
does not describe, also fails the build.

**Positions** (`assessment-report.schema.json`): the estimate is the interval
value minus uncertainty to value plus uncertainty; the reference is a value or a
`[min, max]` range.
- `below` / `above`: the whole interval lies outside the reference.
- `within`: the whole interval lies inside the reference.
- `indeterminate`: the interval overlaps a bound.
- `no_reference`: there is an estimate and no reference.
- `not_applicable`: there is no estimate.
An interval that only touches a bound counts as overlapping it.

**Templates**: row text comes from fixed templates chosen by tier and position
and filled only with the row's own numbers (`report-templates.ts`):
within, below, above, indeterminate, no reference, unsupported and not
measurable, each in a measured and (where it applies) a proxy form. Values print
with one decimal and the unit; quality reasons print in plain words. A jest test
renders every template and fails on any pattern in
`references/banned-phrases.json` (condition names, normal/abnormal, risk, score,
grade words, interpretive verbs). The reviewing clinician's own reading goes only
in `clinicianAssessment`, which the builder never fills.

**Report lifecycle**: a draft is built deterministically from the newest analysed
clip per step plus the reference set and the ml-service catalog. If the catalog
is unavailable the build answers 503; labels are never invented. A clinician may
exclude a row (a reason is required; the row stays in the record) and write an
assessment while the report is a draft. Sign-off re-checks the clinician's
password, sets status `released`, and stores `contentSha256`: the sha256 of the
canonical JSON (sorted keys) of the released body without the digest field
itself, so anyone can recompute it. Releasing, rejecting and every edit are
limited to drafts; a new build creates version N+1 that supersedes the old one.
Reasons for excluding a row or rejecting a draft are capped at 1000 characters.
Sign-off allows 5 wrong passwords per clinician in 15 minutes (in memory, one
backend instance); after that it answers 429 until the window passes. Rejecting
a draft logs a `report_rejected` bookkeeping event with its own schema id
`report-rejection/v0` and a provenance block. It carries clinician free text, so
the research export never includes it. A failure to write that event is logged
and does not undo the rejection.

**Checks on text and references**: every row's label and analysis text, and
every not-measurable entry from the ml-service catalog, is scanned against
`references/banned-phrases.json` when the report is built; a hit fails the build
(422). The reference set is validated against the catalog (unknown metric, unit
mismatch, literature reference for a proxy) on every build and once in the
background at startup. This is later than "at load" in the spec because the tier
and unit come from the ml-service catalog, which is not available at boot; if
ml-service is down at startup the check is skipped with a warning and happens at
the first build.

**Patient access**: the patient's device receives a 180-day `report_reader` token
for one session and can read only that session's latest released report; until
then the route answers 404 `{"status": "pending_review"}`.

## Consequences
- A report can show a value outside its reference without any wording about what
  that means; interpretation is the clinician's.
- Excluded rows remain in the stored released body and in its hash, and the
  clinician's `GET /reports/:id` serves that body whole. The patient route
  `GET /sessions/:id/released-report` returns the same body with the excluded
  rows removed, so a withdrawn measurement never reaches the patient. The
  `contentSha256` it carries is the hash of the whole stored body, so it
  verifies against the clinician copy and not against the patient projection.
- Changing a template means changing reviewed code and re-running the
  banned-phrase test.
