# Cross-Slice Contract Gaps (HANDOFF §4.C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 6 of the 11 cross-slice contract gaps `docs/HANDOFF.md` §4.C lists and says to fix "BEFORE
any integration run": missing `stepId`/`signConvention`/numeric reference bounds on report rows, missing
`clipId` in the steps-status endpoint, a non-sha-qualified landmark storage path, and no concurrency check on
report sign-off. (Items #7, #8, #11 are already done; #9, `report-rejection` schema registration, is folded
in as a small additive task since it's cheap and already-referenced by id elsewhere in the code.)

**Architecture:** Every fix here is additive to an existing schema/endpoint/function — no breaking change, no
new concept. The iOS client already decodes `stepId` and `reference.{value,min,max}` as optional fields
(confirmed: `apps/ios-client/Sources/Report/AssessmentReportBody.swift`) and already has logic gated on
`clipId` (`BatteryRunner.swift:233`) — none of that needs an iOS change, it just starts actually working once
the backend sends the data. The clinician-web client already renders `signConvention` when present
(`apps/clinician-web/src/report/ReportRowsTable.tsx`) for the same reason.

**Tech Stack:** JSON Schema, TypeScript/NestJS (`services/backend-api`), Python (`services/ml-service`), Jest,
pytest.

---

## File structure

**Modify:**
- `packages/schemas/src/assessment-report.schema.json` — row gains optional `stepId`, `signConvention`; row's
  `reference` gains optional `value`/`min`/`max`.
- `packages/schemas/src/*` (generated output via `npm run schemas:generate`, committed as usual).
- `packages/schemas/CHANGELOG.md` — new entry.
- `services/backend-api/src/reports/report-builder.ts` — `buildRow()` fills the three new row fields.
- `services/backend-api/src/reports/report-builder.spec.ts` — updated/added tests.
- `services/backend-api/src/clips/steps.service.ts` — `StepStatusRow` gains `clipId`.
- `services/backend-api/src/clips/steps.service.spec.ts` — updated/added tests.
- `services/backend-api/src/reports/reports.controller.ts` — sign-off route accepts optional
  `contentSha256`/`reportVersion` in the body.
- `services/backend-api/src/reports/reports.service.ts` — `signOff()` checks them against the current draft,
  409s on mismatch.
- `services/backend-api/src/reports/reports.service.spec.ts` — updated/added tests.
- `services/ml-service/app/clips/landmark_store.py` — sha-qualified storage path.
- `services/ml-service/tests/test_landmark_store.py` — updated path assertions.
- `docs/traceability-matrix.md` — note the sign-off concurrency control (ties to HZ-05-adjacent data
  integrity, not a hazard per se — follow the existing "—" convention for non-hazard rows).
- `docs/HANDOFF.md` — mark the 6 items done in §4.C's table (small doc edit, last task).

**Create:**
- `packages/schemas/src/report-rejection.schema.json` — registers the `report-rejection/v0` schema id already
  referenced by `REJECTION_SCHEMA_ID` in `services/backend-api/src/reports/reports.service.ts:28` and tested
  in `reports.service.spec.ts`/`research-export.service.spec.ts`.

---

### Task 1: Schema — `stepId`, `signConvention`, numeric reference bounds

**Files:**
- Modify: `packages/schemas/src/assessment-report.schema.json`
- Modify: `packages/schemas/CHANGELOG.md`

- [ ] **Step 1: Edit the row schema**

In `packages/schemas/src/assessment-report.schema.json`, inside `properties.rows.items.properties`, add two
new optional properties (anywhere among the existing properties; suggested right after `side`):

```json
          "stepId": { "type": ["string", "null"], "description": "Which battery step this row's result came from, so the UI can group/disambiguate left and right rows of the same metric across different steps." },
          "signConvention": { "type": "string", "description": "What a positive value means for this row, e.g. \"positive = right side lower\" (metric-result.schema.json carries the same field)." },
```

And inside `properties.rows.items.properties.reference.properties` (the row's `reference` object), add three
new optional properties alongside the existing `kind`/`label`/`sourceCitation`/`status`:

```json
              "value": { "type": "number", "description": "A single-value reference's numeric value (e.g. 0 for a 0 deg geometric reference). Absent for a range reference." },
              "min": { "type": "number", "description": "A range reference's lower bound. Absent for a single-value reference." },
              "max": { "type": "number", "description": "A range reference's upper bound. Absent for a single-value reference." },
```

None of these six new properties go in any `required` array — this stays purely additive, exactly like the
`method`/`measuredBy` fields added earlier this phase.

- [ ] **Step 2: Regenerate and check**

```bash
npm run schemas:generate && npm run schemas:check
```
Expected: both succeed; `schemas:check` reports the generated output is up to date.

- [ ] **Step 3: Add a CHANGELOG entry**

Append to `packages/schemas/CHANGELOG.md`:

```markdown
## v0 - report row disambiguation and reference bounds (non-breaking)

- `assessment-report`'s row gained **optional** `stepId`, `signConvention`, and (on `reference`) `value`/
  `min`/`max`. All optional, matching the existing pattern for `method`/`measuredBy` - released report bodies
  signed before this change remain valid with no migration.
- `stepId` lets a client group/disambiguate left-and-right rows of the same metric across different battery
  steps; `signConvention` carries the same text `metric-result` already has; the numeric reference bounds let
  a client draw a reference band without parsing the existing text `label` (e.g. "0-5 deg").

See docs/HANDOFF.md §4.C items #1-#3.
```

- [ ] **Step 4: Commit**

```bash
git add packages/schemas/src/assessment-report.schema.json packages/schemas/generated packages/schemas/CHANGELOG.md
git commit -m "schemas: add stepId, signConvention, numeric reference bounds to report rows"
```

---

### Task 2: `report-builder.ts` fills the three new row fields

**Files:**
- Modify: `services/backend-api/src/reports/report-builder.ts`
- Modify: `services/backend-api/src/reports/report-builder.spec.ts`

`buildRow()` already has everything it needs in scope: `result.stepId` (already a `MetricResult` field),
`result.estimate?.signConvention` (already exists on `MetricResult["estimate"]` per
`services/backend-api/src/battery/types.ts`), and `indexed.bounds` (`{ lo: number; hi: number }`, already
computed earlier in `buildRow()` from the reference set).

**Confirmed by reading the actual file:** `row.stepId` is already fully wired - `ReportRow.stepId: string |
null` is already in the interface (`report-builder.ts:44`) and `stepId: result.stepId ?? null,` is already the
first line of the `row` object literal in `buildRow()` (`report-builder.ts:208`). HANDOFF's "stepId" gap was
really a schema-declaration gap (Task 1), not a missing backend behavior - this task's `stepId` test
assertions below are a regression guard confirming that, not new behavior to implement. The real new work in
this task is `signConvention` and the reference's numeric bounds.

- [ ] **Step 1: Write the failing tests**

Add to `services/backend-api/src/reports/report-builder.spec.ts` (near the other `buildReport`/row tests):

```typescript
  it("carries the result's stepId and signConvention onto the row", () => {
    const r = result("static.trunk_inclination", "static.left_lateral", {
      estimate: { value: 2, uncertainty: 0.5, framesUsed: 100, signConvention: "positive = forward" },
    });
    const [row] = buildReport(input([r])).rows;
    expect(row.stepId).toBe("static.left_lateral");
    expect(row.signConvention).toBe("positive = forward");
  });

  it("puts the reference's numeric bounds on the row - a single value as `value`, a range as min/max", () => {
    const single = result("static.trunk_inclination", "static.left_lateral", {
      estimate: { value: 2, uncertainty: 0.5, framesUsed: 100 },
    });
    const [singleRow] = buildReport(input([single])).rows;
    expect(singleRow.reference?.value).toBe(0);
    expect(singleRow.reference?.min).toBeUndefined();
    expect(singleRow.reference?.max).toBeUndefined();

    // Every entry in the checked-in reference file is single-value today (confirmed by
    // reading references/posture-reference.v0-draft.json), so a range case needs a
    // synthetic reference set - same technique already used by the "indexes single-value
    // and range references as bounds" test further down this file.
    const rangedSet: ReferenceRangeSet = { ...REFERENCES, entries: [{ metricKey: "static.hip_line_tilt", kind: "literature", min: -2, max: 4, unit: "deg", sourceCitation: "x" }] };
    const ranged = result("static.hip_line_tilt", "static.anterior", {
      estimate: { value: 1, uncertainty: 0.4, framesUsed: 100 },
    });
    const [rangedRow] = buildReport(input([ranged], { referenceSet: rangedSet })).rows;
    expect(rangedRow.reference?.min).toBe(-2);
    expect(rangedRow.reference?.max).toBe(4);
    expect(rangedRow.reference?.value).toBeUndefined();
  });

  it("stepId always comes from the result, but signConvention/reference are only set when the source data has them", () => {
    const r = result("static.plumb_offset_ear", "static.left_lateral", {
      estimate: { value: 3.1, uncertainty: 0.4, framesUsed: 100 },
    });
    const [row] = buildReport(input([r])).rows;
    expect(row.reference).toBeNull();
    expect(row.stepId).toBe("static.left_lateral"); // still present - stepId always comes from the result
    expect(row.signConvention).toBeUndefined(); // the fixture's shared `provenance`/estimate has no signConvention
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd services/backend-api && npx jest report-builder
```
Expected: the `signConvention` and reference-bounds assertions fail (those fields are `undefined` on the
row); the `stepId` assertions in the same tests already pass today (see the note above) - that's expected,
not a sign something's wrong.

- [ ] **Step 3: Update `ReportRow` and `buildRow()`**

In `services/backend-api/src/reports/report-builder.ts`, add to the `ReportRow` interface (near `method`/`measuredBy`):

```typescript
  stepId?: string | null;
  signConvention?: string;
```

and extend the `reference` field's type to include the numeric bounds:

```typescript
  reference: { kind: "geometric" | "literature"; label: string; sourceCitation: string; status: "draft" | "approved"; value?: number; min?: number; max?: number } | null;
```

In `buildRow()`, where `reference` is currently built:

```typescript
  const reference = indexed
    ? {
        kind: indexed.entry.kind,
        label: formatReferenceLabel(indexed.bounds, indexed.entry.unit),
        sourceCitation: indexed.entry.sourceCitation,
        status: referenceStatus,
      }
    : null;
```

change to:

```typescript
  const reference = indexed
    ? {
        kind: indexed.entry.kind,
        label: formatReferenceLabel(indexed.bounds, indexed.entry.unit),
        sourceCitation: indexed.entry.sourceCitation,
        status: referenceStatus,
        ...(indexed.bounds.lo === indexed.bounds.hi
          ? { value: indexed.bounds.lo }
          : { min: indexed.bounds.lo, max: indexed.bounds.hi }),
      }
    : null;
```

`row.stepId` is already populated (`stepId: result.stepId ?? null,` is already the first line of the `row`
object literal) - leave it exactly as it is, no change needed there. Add `signConvention` as a conditional
field, alongside the existing `if (result.unsupported) row.unsupportedReasons = [...]` pattern already in the
function (find that line and add this right after it, matching its exact style):

```typescript
  if (result.estimate?.signConvention) row.signConvention = result.estimate.signConvention;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd services/backend-api && npx jest report-builder
```
Expected: all tests pass, including the 3 new ones.

- [ ] **Step 5: Run the full backend suite**

```bash
cd services/backend-api && npx prisma generate && npx jest
```
Expected: all 380+ tests pass (the existing whole-row `toEqual` assertions in `report-builder.spec.ts` may
need their expected objects updated to include the new fields where present - if any existing test breaks
this way, that's expected per the plan, update the expected object the same way earlier `method`/`measuredBy`
additions were handled in this file's history).

- [ ] **Step 6: Commit**

```bash
git add services/backend-api/src/reports/report-builder.ts services/backend-api/src/reports/report-builder.spec.ts
git commit -m "backend: report rows carry stepId, signConvention, and numeric reference bounds"
```

---

### Task 3: `clipId` on the steps-status endpoint

**Files:**
- Modify: `services/backend-api/src/clips/steps.service.ts`
- Modify: `services/backend-api/src/clips/steps.service.spec.ts`

`statusFor()` already has the clip object (with `.id`) in scope for every status it returns except `"missing"`.

- [ ] **Step 1: Write the failing test**

Add to `services/backend-api/src/clips/steps.service.spec.ts`, inside the existing
`describe("StepsService.statusFor", ...)` block (this file already has top-level helpers `build`, `keysOf`,
`estimate`, `at` - reuse them exactly as the other tests in the file do, don't invent new ones):

```typescript
  it("includes the newest clip's id so the client can detect a stale status after a Redo", async () => {
    const results = keysOf("static.posterior").map((k) => estimate("c1", "static.posterior", k));
    const { service } = build([{ id: "c1", stepId: "static.posterior", status: "analyzed", createdAt: at(1) }], results);
    const step = (await service.statusFor("s1")).find((s) => s.stepId === "static.posterior")!;
    expect(step.clipId).toBe("c1");
  });

  it("has a null clipId for a step with no clip at all", async () => {
    const { service } = build([], []);
    const step = (await service.statusFor("s1")).find((s) => s.stepId === "static.anterior")!;
    expect(step.clipId).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd services/backend-api && npx jest steps.service
```
Expected: fails (no `clipId` key on the returned object yet, or `toBeUndefined()` where `toBeNull()`/a real id is expected).

- [ ] **Step 3: Add `clipId` to `StepStatusRow` and `statusFor()`**

In `services/backend-api/src/clips/steps.service.ts`, change the interface:

```typescript
export interface StepStatusRow {
  stepId: string;
  status: StepStatus;
  /** True only when every metric of the step has an estimate (nothing is unsupported). */
  usable: boolean;
  /** Distinct quality reasons of the step's unsupported results, in first-seen order. */
  reasons: string[];
  /** The newest clip's id for this step, or null if there is none - lets the client
      detect that a status response is about a clip it already replaced via Redo. */
  clipId: string | null;
}
```

And in `statusFor()`'s `this.battery.battery.steps.map((step) => { ... })`, add `clipId: clip?.id ?? null` to
every returned object (there are currently 4 return points: missing, failed, processing, analyzed):

```typescript
    return this.battery.battery.steps.map((step) => {
      const clip = newest.get(step.stepId);
      if (!clip) return { stepId: step.stepId, status: "missing", usable: false, reasons: [], clipId: null };
      if (clip.status === "failed") return { stepId: step.stepId, status: "failed", usable: false, reasons: [], clipId: clip.id };
      if (clip.status !== "analyzed") return { stepId: step.stepId, status: "processing", usable: false, reasons: [], clipId: clip.id };

      // ...(the rest of the function body is unchanged up to the return)...
      return { stepId: step.stepId, status: "analyzed", usable, reasons, clipId: clip.id };
    });
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd services/backend-api && npx jest steps.service
```
Expected: all pass, including the new test.

- [ ] **Step 5: Run the full backend suite**

```bash
cd services/backend-api && npx jest
```
Expected: all tests pass (any existing test asserting an exact `StepStatusRow` shape via `toEqual` will need
its expected object updated to include `clipId`).

- [ ] **Step 6: Commit**

```bash
git add services/backend-api/src/clips/steps.service.ts services/backend-api/src/clips/steps.service.spec.ts
git commit -m "backend: include clipId in GET /sessions/:id/steps so a client can detect a stale status after Redo"
```

---

### Task 4: Sha-qualify the landmark series storage path

**Files:**
- Modify: `services/ml-service/app/clips/landmark_store.py`
- Modify: `services/ml-service/tests/test_landmark_store.py`

Today `store_landmark_series` writes to `landmarks/<clipId>.json.gz`. A re-analysis of the same clip
overwrites that file, so a stored `MetricResult.evidence.landmarkSeriesSha256` from before the re-analysis can
no longer be matched to the bytes it names. Fix: key the path by `(clipId, sha256)` instead of `clipId` alone
- `landmarks/<clipId>/<sha256>.json.gz`. The sha256 is already computed from `data` before the file is
written, so this only needs the path construction moved after that computation.

- [ ] **Step 1: Update the failing tests first**

In `services/ml-service/tests/test_landmark_store.py`, update the path assertions to the new sha-qualified
shape. The sha is only known after hashing the gzip bytes, so a test can't predict the exact path string in
advance the way the old test did (`tmp_path / "landmarks" / "clip-1.json.gz"`) - instead assert the returned
`info["path"]` matches the pattern `landmarks/<clipId>/<sha256>.json.gz` using the returned `info["sha256"]`:

```python
def test_series_is_gzip_json_with_a_matching_sha256(tmp_path):
    frames = make_frames(anterior_pose(), n=3)
    info = store_landmark_series(
        tmp_path, clip_id="clip-1", session_id="s", step_id="static.anterior", view="anterior",
        width=1080, height=1920, model_version="mediapipe-pose-full/x", observations=frames,
    )
    assert info["path"] == str(tmp_path / "landmarks" / "clip-1" / f"{info['sha256']}.json.gz")
    data = Path(info["path"]).read_bytes()
    assert info["sha256"] == hashlib.sha256(data).hexdigest()
    body = json.loads(gzip.decompress(data))
    assert body["clipId"] == "clip-1" and body["modelVersion"] == "mediapipe-pose-full/x"
    assert body["width"] == 1080 and len(body["frames"]) == 3
    f0 = body["frames"][0]
    assert len(f0["points"]) == 33 and len(f0["points"][0]) == 2 and len(f0["visibility"]) == 33
    assert f0["gravity"] == [0.0, 1.0, 0.0] and f0["t"] == 0.0
```

(Add `from pathlib import Path` to the test file's imports if not already present.) Update
`test_frames_without_a_pose_store_null_not_zeros` and `test_same_input_gives_the_same_bytes` similarly -
wherever they open `info["path"]` directly they already work unchanged since they use the returned path, not
a hardcoded one; only the one assertion above hardcodes the old shape.

Update the LAST test, `test_temp_file_name_is_unique_and_no_part_file_is_left_behind` - its final assertion
`assert [p.name for p in (tmp_path / "landmarks").iterdir()] == ["c.json.gz"]` lists the `landmarks/`
directory's direct children and expects one file; under the new scheme `landmarks/` will contain one
subdirectory per clip id, not files directly. Change it to:

```python
    clip_dirs = list((tmp_path / "landmarks").iterdir())
    assert len(clip_dirs) == 1 and clip_dirs[0].name == "c"
    files_in_clip_dir = list(clip_dirs[0].iterdir())
    assert len(files_in_clip_dir) == 1 and files_in_clip_dir[0].suffix == ".gz"
```

(Two calls with identical `kwargs` produce identical bytes and thus the identical sha256 and the identical
final filename - the second call overwrites the same path via the existing tmp-file-then-replace mechanism,
so there's still exactly one file in the clip's subdirectory afterward, which is what the original test was
checking: no leftover `.part` files. This still holds under the new path scheme.)

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd services/ml-service && .venv/bin/python -m pytest tests/test_landmark_store.py -q
```
Expected: fails against the current (old-path) implementation.

- [ ] **Step 3: Update `landmark_store.py`**

In `services/ml-service/app/clips/landmark_store.py`, move the sha256 computation before the path is decided,
and qualify the directory by clip id and the final filename by sha256:

```python
    raw = json.dumps(body, separators=(",", ":")).encode()
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
        gz.write(raw)
    data = buf.getvalue()
    sha256 = hashlib.sha256(data).hexdigest()

    target_dir = Path(clip_dir) / "landmarks" / clip_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{sha256}.json.gz"
    # Unique temp name: concurrent analyses of one clip must not share a half-written file.
    tmp = target.with_name(f"{target.name}.{os.getpid()}.{uuid.uuid4().hex}.part")
    try:
        tmp.write_bytes(data)
        tmp.replace(target)
    finally:
        tmp.unlink(missing_ok=True)
    return {"path": str(target), "sha256": sha256}
```

(This removes the old `data = buf.getvalue()` / later `hashlib.sha256(data).hexdigest()` duplication - there
should be exactly one place `data` and `sha256` are computed now.) Also update the module's own doc comment
at the top of the file, which currently says the path is `<clip dir>/landmarks/<clipId>.json.gz` and that
"the file is keyed by clipId only" - update both sentences to describe the new `<clipId>/<sha256>.json.gz`
scheme and that re-analysis no longer overwrites a prior result's bytes (a new sha256 from different model
output lands at a new filename; only a byte-identical re-analysis would reuse the same path, same as before).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd services/ml-service && .venv/bin/python -m pytest tests/test_landmark_store.py -q
```
Expected: all pass.

- [ ] **Step 5: Run the full ml-service suite**

```bash
cd services/ml-service && .venv/bin/python -m pytest -q
```
Expected: all tests pass, including `tests/test_clip_analyze_api.py` (which exercises the full analyze flow
and touches this code path indirectly).

- [ ] **Step 6: Commit**

```bash
git add services/ml-service/app/clips/landmark_store.py services/ml-service/tests/test_landmark_store.py
git commit -m "ml-service: sha-qualify the landmark series storage path (re-analysis no longer overwrites a cited result's bytes)"
```

---

### Task 5: Sign-off concurrency check

**Files:**
- Modify: `services/backend-api/src/reports/reports.controller.ts`
- Modify: `services/backend-api/src/reports/reports.service.ts`
- Modify: `services/backend-api/src/reports/reports.service.spec.ts`

Today `signOff()` already 409s if the report's `status` changed out from under it (`updateMany` + `count ===
0` check), but it does NOT detect a *content* change - e.g. a second clinician excluding a row or editing the
assessment text between when this clinician loaded the report to review and when they click sign. Fix: let
the client optionally send the `contentSha256` and `reportVersion` it last saw; if both are supplied and
either doesn't match the current draft, 409 before touching anything.

- [ ] **Step 1: Write the failing tests**

Add to `services/backend-api/src/reports/reports.service.spec.ts`, inside the existing
`describe("ReportsService.signOff", ...)` block. This file already imports `reportContentSha256` from
`./canonical-json` (line 14) and has `setup()`/`draftRow()` helpers - reuse them exactly as the other tests
in this block do:

```typescript
  it("signs off successfully when the caller's contentSha256/reportVersion match the current draft", async () => {
    const row = draftRow();
    const { service } = setup({ reports: [row] });
    const expectedSha = reportContentSha256(row.body as never);
    const body = await service.signOff("rep-1", "clin1", "correct horse", expectedSha, row.reportVersion);
    expect(body.status).toBe("released");
  });

  it("409s when the caller's contentSha256 no longer matches (someone else changed the draft first)", async () => {
    const row = draftRow();
    const { service, store } = setup({ reports: [row] });
    const staleSha = reportContentSha256(row.body as never);
    // Someone else excludes a row first, changing the stored draft's content.
    await service.excludeRow("rep-1", "clin2", {
      metricKey: "static.hip_line_tilt",
      side: null,
      stepId: "static.posterior",
      reason: "Subject moved",
    });
    await expect(service.signOff("rep-1", "clin1", "correct horse", staleSha, row.reportVersion)).rejects.toThrow(ConflictException);
    expect(store[0].status).toBe("draft");
  });

  it("409s when the caller's reportVersion no longer matches", async () => {
    const row = draftRow();
    const { service } = setup({ reports: [row] });
    const currentSha = reportContentSha256(row.body as never);
    await expect(service.signOff("rep-1", "clin1", "correct horse", currentSha, row.reportVersion + 1)).rejects.toThrow(ConflictException);
  });

  it("still signs off with no contentSha256/reportVersion supplied at all (back-compat: an older client)", async () => {
    const { service } = setup({ reports: [draftRow()] });
    const body = await service.signOff("rep-1", "clin1", "correct horse");
    expect(body.status).toBe("released");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd services/backend-api && npx jest reports.service
```
Expected: the new tests fail (the service doesn't accept or check these fields yet - the "matches" test may
pass trivially since there's nothing to mismatch yet, but the "409s on mismatch" test must fail until this is
implemented).

- [ ] **Step 3: Update the controller route**

In `services/backend-api/src/reports/reports.controller.ts`, change:

```typescript
  @Post(":reportId/sign-off")
  signOff(@Param("reportId") reportId: string, @Body() body: { password: string }, @Req() req: ClinicianRequest) {
    return this.reports.signOff(reportId, req.user.sub, body?.password);
  }
```

to:

```typescript
  @Post(":reportId/sign-off")
  signOff(
    @Param("reportId") reportId: string,
    @Body() body: { password: string; contentSha256?: string; reportVersion?: number },
    @Req() req: ClinicianRequest
  ) {
    return this.reports.signOff(reportId, req.user.sub, body?.password, body?.contentSha256, body?.reportVersion);
  }
```

- [ ] **Step 4: Update `signOff()` in the service**

In `services/backend-api/src/reports/reports.service.ts`, change the method signature and add the check
right after `this.assertNotLocked(clinicianId)` and before the password check (so a stale-content attempt is
rejected before the password-attempt counter is touched):

```typescript
  async signOff(
    reportId: string,
    clinicianId: string,
    password: string,
    expectedContentSha256?: string,
    expectedReportVersion?: number
  ): Promise<AssessmentReportBody> {
    if (typeof password !== "string" || password.length === 0) throw new BadRequestException("password is required.");
    const row = await this.load(reportId);
    this.assertDraft(row.status);
    this.assertNotLocked(clinicianId);

    if (expectedContentSha256 !== undefined || expectedReportVersion !== undefined) {
      const currentBody = row.body as unknown as AssessmentReportBody;
      const currentSha = reportContentSha256(currentBody as never);
      if (
        (expectedContentSha256 !== undefined && expectedContentSha256 !== currentSha) ||
        (expectedReportVersion !== undefined && expectedReportVersion !== currentBody.reportVersion)
      ) {
        throw new ConflictException("This report changed since you last reviewed it. Reload and try again.");
      }
    }

    const clinician = await this.prisma.clinician.findUnique({ where: { id: clinicianId } });
    // ...(rest of the method is unchanged)...
```

(`ConflictException` is already imported in this file per the existing `updated.count === 0` check further
down - confirm the import before assuming, don't add a duplicate import if it's already there.)

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd services/backend-api && npx jest reports.service
```
Expected: all pass.

- [ ] **Step 6: Run the full backend suite**

```bash
cd services/backend-api && npx jest
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add services/backend-api/src/reports/reports.controller.ts services/backend-api/src/reports/reports.service.ts services/backend-api/src/reports/reports.service.spec.ts
git commit -m "backend: sign-off detects a concurrent content change, not just a status race"
```

---

### Task 6: Register the `report-rejection` schema

**Files:**
- Create: `packages/schemas/src/report-rejection.schema.json`
- Modify: `packages/schemas/CHANGELOG.md`

`services/backend-api/src/reports/reports.service.ts:28` already exports `REJECTION_SCHEMA_ID =
"report-rejection/v0"` and uses it as an event's `schemaId` when a report is rejected
(`reports.service.spec.ts`/`research-export.service.spec.ts` both assert this id) - but no schema file defines
what that record's shape actually is. This task only registers the schema; it does not change what
`reports.service.ts` emits. The real emitted payload (`reports.service.ts:271-281`, inside `reject()`) is:

```typescript
await this.events.append(row.sessionId, "report_rejected", REJECTION_SCHEMA_ID, {
  reportId,
  clinicianId,
  reason: trimmed,
  provenance: {
    schemaVersion: REJECTION_SCHEMA_ID,
    modelVersion: REPORT_BUILDER_VERSION,
    calibrationVersion: "none/v0",
    producedAt: new Date().toISOString(),
  },
});
```

- [ ] **Step 1: Write the schema file matching that real shape**

Create `packages/schemas/src/report-rejection.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.beaive.dev/report-rejection.schema.json",
  "title": "ReportRejection",
  "description": "Bookkeeping event logged when a clinician rejects a draft report (ADR-015) - why the draft was withdrawn, not a measurement or an assessment. The clinician's reason is free text, so this record is deliberately left out of the research export.",
  "type": "object",
  "version": "v0",
  "required": ["reportId", "clinicianId", "reason", "provenance"],
  "properties": {
    "reportId": { "type": "string" },
    "clinicianId": { "type": "string" },
    "reason": { "type": "string", "minLength": 1 },
    "provenance": { "$ref": "common.schema.json#/$defs/provenance" }
  }
}
```

This matches the real emitted payload field-for-field: `reportId`, `clinicianId`, `reason` (required,
non-blank - the service already enforces non-blank via `MAX_REASON_CHARS`/trim before emitting), and
`provenance` reusing the same shared `$defs/provenance` every other record type already uses.

- [ ] **Step 2: Regenerate and check**

```bash
npm run schemas:generate && npm run schemas:check
```

- [ ] **Step 3: Add a CHANGELOG entry**

```markdown
## v0 - report-rejection schema registered (non-breaking, new record type)

- New `report-rejection` schema, `version: "v0"`, matching the `report-rejection/v0` event id
  `services/backend-api/src/reports/reports.service.ts` already emits - previously an id with no registered
  shape (HANDOFF §4.C item #9).
```

- [ ] **Step 4: Commit**

```bash
git add packages/schemas/src/report-rejection.schema.json packages/schemas/generated packages/schemas/CHANGELOG.md
git commit -m "schemas: register report-rejection/v0, matching what reports.service.ts already emits"
```

---

### Task 7: Update `docs/HANDOFF.md` and `docs/traceability-matrix.md`

**Files:**
- Modify: `docs/HANDOFF.md`
- Modify: `docs/traceability-matrix.md`

- [ ] **Step 1: Mark items #1, #2, #3, #4, #5, #6, #9 done in HANDOFF's §4.C table**

In `docs/HANDOFF.md`, find the §4.C table (`| # | Gap | Recommended fix |`) and, for each of rows 1-6 and 9,
either remove the row or append " — **done**, see commit history on `v2-brand`" to its "Recommended fix" cell
(match whichever editing style the rest of that doc already uses for marking something resolved - check
nearby sections for precedent before choosing). Items #7, #8, #10, #11 are unaffected by this plan; leave
their rows exactly as they are (#7, #8, #11 are already noted done elsewhere in this plan's investigation;
#10 - exact response-shape contract tests - remains genuinely open and should stay listed).

- [ ] **Step 2: Add a traceability-matrix row for the sign-off concurrency control**

Follow the exact table format already established in `docs/traceability-matrix.md` (see this session's
earlier `measurementMethod`/`measuredBy` rows for the pattern: Schema | Schema version | Model/adapter version
| Hazard control(s) satisfied | Notes). Use `—` for the hazard column (this is a data-integrity control, not
one of the numbered HZ hazards) and name the verification test: `reports.service.spec.ts` → "409s when the
caller's contentSha256 no longer matches".

- [ ] **Step 3: Commit**

```bash
git add docs/HANDOFF.md docs/traceability-matrix.md
git commit -m "docs: mark HANDOFF §4.C items 1-6,9 done; traceability row for sign-off concurrency check"
```

---

## Verification (after all tasks)

- `cd services/backend-api && npx prisma generate && npx jest` — full suite green.
- `cd services/ml-service && .venv/bin/python -m pytest -q` — full suite green.
- `npm run schemas:generate && npm run schemas:check` — clean.
- `npm run lint:claims` — clean (no copy changed, but cheap to confirm).
- `npm run web:test && npm run web:build` — clinician-web already consumes `signConvention`; confirm nothing
  broke now that the field can actually arrive populated.
- Manually re-read `docs/HANDOFF.md` §4.C to confirm only items #7, #8, #10, #11 remain genuinely open.
