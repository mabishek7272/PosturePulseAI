import Ajv2020, { ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

// Raw JSON Schema files (packages/schemas/src) are the single source of truth for
// validation - see docs/adr/002-schema-source-of-truth.md. This registry compiles
// them once and exposes a validator per record type, keyed by the schema file
// name (matches DecisionEvent.evidence[].type and QualityGateFlag/Event.schemaId
// naming convention: "<name>/v0").
import adverseEventRecord from "../../../../packages/schemas/src/adverse-event-record.schema.json";
import cameraIntrinsics from "../../../../packages/schemas/src/camera-intrinsics.schema.json";
import cameraPose from "../../../../packages/schemas/src/camera-pose.schema.json";
import calibratedJointFrame from "../../../../packages/schemas/src/calibrated-joint-frame.schema.json";
import consentRecord from "../../../../packages/schemas/src/consent-record.schema.json";
import decisionEvent from "../../../../packages/schemas/src/decision-event.schema.json";
import exposureEvent from "../../../../packages/schemas/src/exposure-event.schema.json";
import movementPhaseEvent from "../../../../packages/schemas/src/movement-phase-event.schema.json";
import objectDetectionFrame from "../../../../packages/schemas/src/object-detection-frame.schema.json";
import poseLandmarkFrame from "../../../../packages/schemas/src/pose-landmark-frame.schema.json";
import protocolDefinition from "../../../../packages/schemas/src/protocol-definition.schema.json";
import qualityGateFlag from "../../../../packages/schemas/src/quality-gate-flag.schema.json";
import scaleCalibrationRecord from "../../../../packages/schemas/src/scale-calibration-record.schema.json";
import sensorReading from "../../../../packages/schemas/src/sensor-reading.schema.json";
import session from "../../../../packages/schemas/src/session.schema.json";
import symptomReport from "../../../../packages/schemas/src/symptom-report.schema.json";
import common from "../../../../packages/schemas/src/common.schema.json";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(common as unknown as object);

const SCHEMAS: Record<string, object> = {
  "adverse-event-record": adverseEventRecord,
  "camera-intrinsics": cameraIntrinsics,
  "camera-pose": cameraPose,
  "calibrated-joint-frame": calibratedJointFrame,
  "consent-record": consentRecord,
  "decision-event": decisionEvent,
  "exposure-event": exposureEvent,
  "movement-phase-event": movementPhaseEvent,
  "object-detection-frame": objectDetectionFrame,
  "pose-landmark-frame": poseLandmarkFrame,
  "protocol-definition": protocolDefinition,
  "quality-gate-flag": qualityGateFlag,
  "scale-calibration-record": scaleCalibrationRecord,
  "sensor-reading": sensorReading,
  session,
  "symptom-report": symptomReport,
};

const validators = new Map<string, ValidateFunction>();

export function getValidator(schemaName: keyof typeof SCHEMAS): ValidateFunction {
  const cached = validators.get(schemaName);
  if (cached) return cached;
  const schema = SCHEMAS[schemaName];
  if (!schema) {
    throw new Error(`Unknown schema "${schemaName}" - not registered in schema-registry.ts`);
  }
  const compiled = ajv.compile(schema);
  validators.set(schemaName, compiled);
  return compiled;
}

export function schemaVersionId(schemaName: keyof typeof SCHEMAS): string {
  const schema = SCHEMAS[schemaName] as { version?: string };
  return `${schemaName}/${schema.version ?? "v0"}`;
}
