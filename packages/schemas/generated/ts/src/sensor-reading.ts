/* eslint-disable */
/**
 * Generated from packages/schemas/src/sensor-reading.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * Optional, clearly-non-gating wearable/sensor input (PRD 4.6 default: symptom entry is mandatory regardless; sensor integration is optional research context only). MUST NOT be referenced by any safety-FSM transition or DecisionEvent.action other than as descriptive evidence.
 */
export interface SensorReading {
  sensorReadingId: string;
  sessionId: string;
  sensorType: "heart_rate";
  value: number;
  unit: "bpm";
  recordedAt: string;
  sourceDeviceId?: string | null;
  /**
   * Must correspond to a ConsentRecord with 'wearable_integration' in scopes; enforced at the backend-api ingestion endpoint, not by this schema alone.
   */
  consentScopeRef: string;
}
