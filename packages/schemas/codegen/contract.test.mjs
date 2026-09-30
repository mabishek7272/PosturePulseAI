// Proves the raw JSON Schema (single source of truth) still enforces the
// cross-field business rules that generate-ts.mjs strips for TypeScript's sake
// (see stripConditionalOnlyAllOf). Runtime validation is what actually matters
// for "never fabricate a measurement" / "cue requires a payload" - the generated
// TS type is a convenience, not the enforcement mechanism.
import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { loadAndDereferenceSchemas } from "./bundle.mjs";

const schemas = await loadAndDereferenceSchemas();
const byName = Object.fromEntries(schemas.map((s) => [s.name, s.schema]));

function validatorFor(name) {
  // Schemas declare $schema: draft 2020-12 - the plain Ajv export only ships the
  // draft-07 meta-schema, so this must use the 2020-12-aware build.
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(byName[name]);
}

test("quality-gate-flag: unsupported requires non-empty reasons", () => {
  const validate = validatorFor("quality-gate-flag");

  const bad = {
    flagId: "f1", sessionId: "s1", frameId: "fr1",
    evaluatedAt: "2026-01-01T00:00:00Z",
    state: "unsupported", reasons: [], affectedOutputs: [],
  };
  assert.equal(validate(bad), false, "unsupported with empty reasons must fail");

  const good = { ...bad, reasons: ["occlusion"], affectedOutputs: ["kneeFlexionAngle"] };
  assert.equal(validate(good), true, JSON.stringify(validate.errors));
});

test("decision-event: action=cue requires a non-null cuePayload", () => {
  const validate = validatorFor("decision-event");

  const base = {
    decisionEventId: "d1", sessionId: "s1",
    evaluatedAt: "2026-01-01T00:00:00Z",
    evidence: [{ type: "quality-gate-flag", refId: "f1" }],
    rule: { ruleId: "r1", ruleVersion: "v0", description: "test" },
    version: "policy-v0",
    expiry: "2026-01-01T00:05:00Z",
  };

  assert.equal(validate({ ...base, action: "cue", cuePayload: null }), false, "cue with null cuePayload must fail");
  assert.equal(
    validate({ ...base, action: "cue", cuePayload: { cueId: "c1", text: "straighten your back" } }),
    true,
    JSON.stringify(validate.errors)
  );
  assert.equal(validate({ ...base, action: "no_action", cuePayload: null }), true, JSON.stringify(validate.errors));
});

test("pose-landmark-frame: occluded landmark must have null position", () => {
  const validate = validatorFor("pose-landmark-frame");

  const frame = (position, observationState) => ({
    frameId: "fr1", sessionId: "s1", personTrackId: "p1",
    capturedAt: "2026-01-01T00:00:00Z", frame: "B",
    landmarks: [{ jointName: "leftKnee", position, confidence: 0.9, observationState }],
    provenance: {
      schemaVersion: "pose-landmark-frame/v0", modelVersion: "mediapipe-pose/0.10.9",
      calibrationVersion: "cal-1", producedAt: "2026-01-01T00:00:00Z",
    },
  });

  assert.equal(validate(frame([0.1, 0.2, 0.3], "occluded")), false, "occluded with a fabricated position must fail");
  assert.equal(validate(frame(null, "occluded")), true, JSON.stringify(validate.errors));
  assert.equal(validate(frame([0.1, 0.2, 0.3], "observed")), true, JSON.stringify(validate.errors));
});

test("protocol-definition: draft status forces clinicallyValidated=false and reviewedBy=null", () => {
  const validate = validatorFor("protocol-definition");

  const base = {
    protocolId: "sit-to-stand", version: "v0-draft", name: "Sit to stand",
    targetPopulation: "adult rehab, low fall risk", deploymentContext: ["clinic_supervised", "home_rehab"],
    exercises: [{ exerciseId: "e1", name: "Sit to stand", phase: "ascend", repRange: { min: 3, max: 8 }, toleranceDegrees: 10, restSeconds: 30 }],
    contraindications: ["acute hip fracture"], symptomStopRules: ["stop on dizziness"],
    createdAt: "2026-01-01T00:00:00Z",
  };

  assert.equal(
    validate({ ...base, status: "draft", clinicallyValidated: true, reviewedBy: null }),
    false,
    "draft protocol cannot claim clinicallyValidated=true"
  );
  assert.equal(
    validate({ ...base, status: "draft", clinicallyValidated: false, reviewedBy: null }),
    true,
    JSON.stringify(validate.errors)
  );
});

test("movement-phase-event: validated must be false, true is rejected", () => {
  const validate = validatorFor("movement-phase-event");
  const base = {
    movementPhaseEventId: "m1", sessionId: "s1", exerciseId: "sts-01",
    windowStartAt: "2026-01-01T00:00:00Z", windowEndAt: "2026-01-01T00:00:02Z",
    modelArchitecture: "tcn", predictedPhase: "ascend", phaseConfidence: 0.5, repCountDelta: 1,
    evidence: [{ type: "calibrated-joint-frame", refId: "cjf-1" }],
    provenance: {
      schemaVersion: "movement-phase-event/v0", modelVersion: "tcn-untrained/v0",
      calibrationVersion: "none/v0", producedAt: "2026-01-01T00:00:00Z",
    },
  };

  assert.equal(validate({ ...base, validated: true }), false, "validated=true must never be schema-valid in this phase");
  assert.equal(validate({ ...base, validated: false }), true, JSON.stringify(validate.errors));
});

test("object-detection-frame: rejects a non-generic ergonomic label", () => {
  const validate = validatorFor("object-detection-frame");
  const base = {
    detectionFrameId: "d1", sessionId: "s1", capturedAt: "2026-01-01T00:00:00Z", frame: "I",
    provenance: {
      schemaVersion: "object-detection-frame/v0", modelVersion: "torchvision-fasterrcnn/v0",
      calibrationVersion: "none/v0", producedAt: "2026-01-01T00:00:00Z",
    },
  };

  assert.equal(
    validate({ ...base, detections: [{ label: "monitor", boundingBox: { xMin: 0, yMin: 0, xMax: 1, yMax: 1 }, confidence: 0.9 }] }),
    false,
    "task-specific ergonomic labels (e.g. 'monitor') are out of scope this phase - see ADR-006"
  );
  assert.equal(
    validate({ ...base, detections: [{ label: "tv", boundingBox: { xMin: 0, yMin: 0, xMax: 1, yMax: 1 }, confidence: 0.9 }] }),
    true,
    JSON.stringify(validate.errors)
  );
});

test("scale-calibration-record: only the four TRD-approved methods validate", () => {
  const validate = validatorFor("scale-calibration-record");
  const base = {
    scaleCalibrationId: "sc1", sessionId: "s1", validatedAt: "2026-01-01T00:00:00Z",
    referenceSourceFrameId: "fr1", scaleFactorMetersPerUnit: 1.7, uncertaintyMetersPerUnit: 0.05,
    provenance: {
      schemaVersion: "scale-calibration-record/v0", modelVersion: "n/a",
      calibrationVersion: "none/v0", producedAt: "2026-01-01T00:00:00Z",
    },
  };

  assert.equal(validate({ ...base, method: "subject_specific" }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...base, method: "laser_rangefinder" }), false, "unapproved method must be rejected");
});

test("sensor-reading: heart_rate/bpm validates, an unsupported sensor type does not", () => {
  const validate = validatorFor("sensor-reading");
  const base = {
    sensorReadingId: "sr1", sessionId: "s1", value: 72, recordedAt: "2026-01-01T00:00:00Z",
    consentScopeRef: "consent-1",
  };

  assert.equal(validate({ ...base, sensorType: "heart_rate", unit: "bpm" }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...base, sensorType: "blood_pressure", unit: "mmHg" }), false, "only heart_rate/bpm is in scope this phase");
});

test("exposure-event: validSeconds cannot be negative and evidence must be non-empty", () => {
  const validate = validatorFor("exposure-event");
  const base = {
    exposureEventId: "ex1", sessionId: "s1", postureBucket: "neutral",
    windowStartAt: "2026-01-01T00:00:00Z", windowEndAt: "2026-01-01T00:01:00Z",
    totalWindowSeconds: 60,
    provenance: {
      schemaVersion: "exposure-event/v0", modelVersion: "posture-bucket-classifier/v0",
      calibrationVersion: "none/v0", producedAt: "2026-01-01T00:00:00Z",
    },
  };

  assert.equal(validate({ ...base, validSeconds: 45, evidence: [] }), false, "evidence must be non-empty");
  assert.equal(validate({ ...base, validSeconds: -1, evidence: [{ type: "calibrated-joint-frame", refId: "cjf-1" }] }), false, "validSeconds cannot be negative");
  assert.equal(validate({ ...base, validSeconds: 45, evidence: [{ type: "calibrated-joint-frame", refId: "cjf-1" }] }), true, JSON.stringify(validate.errors));
});

test("protocol-definition: targetJointAngles is optional and, when present, requires jointName+targetDegrees", () => {
  const validate = validatorFor("protocol-definition");
  const base = {
    protocolId: "sit-to-stand", version: "v0-draft", name: "Sit to stand", status: "draft",
    clinicallyValidated: false, reviewedBy: null,
    targetPopulation: "adult rehab, low fall risk", deploymentContext: ["clinic_supervised", "home_rehab"],
    contraindications: ["acute hip fracture"], symptomStopRules: ["stop on dizziness"],
    createdAt: "2026-01-01T00:00:00Z",
  };

  const exerciseWithout = { exerciseId: "e1", name: "Sit to stand", phase: "ascend", repRange: { min: 3, max: 8 }, toleranceDegrees: 10, restSeconds: 30 };
  assert.equal(validate({ ...base, exercises: [exerciseWithout] }), true, "an exercise without targetJointAngles must still validate (falls back to no_action)");

  const exerciseWith = { ...exerciseWithout, targetJointAngles: [{ jointName: "leftKnee", targetDegrees: 170 }] };
  assert.equal(validate({ ...base, exercises: [exerciseWith] }), true, JSON.stringify(validate.errors));

  const exerciseMalformed = { ...exerciseWithout, targetJointAngles: [{ jointName: "leftKnee" }] };
  assert.equal(validate({ ...base, exercises: [exerciseMalformed] }), false, "targetDegrees is required when targetJointAngles is present");
});

test("adverse-event-record: requires the clinical-trial fields and rejects an unapproved causality/outcome value", () => {
  const validate = validatorFor("adverse-event-record");
  const base = {
    adverseEventRecordId: "ae1", subjectPseudoId: "subj-1", reportedByClinicianId: "clin-1",
    onsetAt: "2026-01-01T00:00:00Z", reportedAt: "2026-01-01T01:00:00Z",
    description: "Subject reported dizziness during sit-to-stand, resolved after rest.",
    severity: "moderate", serious: false, actionTaken: "session_paused",
  };

  assert.equal(validate({ ...base, causality: "possible", outcome: "resolved" }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...base, causality: "made_up", outcome: "resolved" }), false, "an unapproved causality value must be rejected");
  assert.equal(validate({ ...base, causality: "possible", outcome: "made_up" }), false, "an unapproved outcome value must be rejected");

  const missingSeverity = { ...base, causality: "possible", outcome: "resolved" };
  delete missingSeverity.severity;
  assert.equal(validate(missingSeverity), false, "severity is required");
});
