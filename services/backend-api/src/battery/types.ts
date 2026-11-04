// Hand-kept TypeScript views of the M1 contracts (packages/schemas/src). The
// JSON Schemas stay the source of truth: every value typed here is validated
// against its schema (common/schema-registry.ts) before it is trusted.

export type View = "anterior" | "posterior" | "left_lateral" | "right_lateral";

export interface BatterySubBlock {
  phase: "relaxed" | "habitual" | "standardized";
  durationSeconds: number;
  instruction: string;
  /** What the person does to get into this sub-phase before its timer starts. */
  preparation?: string | null;
}

export interface BatteryStep {
  stepId: string;
  module: "static" | "functional" | "gait" | "workstation";
  title: string;
  instruction: string;
  view: View;
  kind: "hold" | "reps" | "passes";
  durationSeconds?: number;
  reps?: number;
  minFps: number;
  levelToleranceDegrees?: number;
  modes: Array<"clinic" | "patient">;
  metricKeys: string[];
  /**
   * HZ-09. A step with this set cannot be captured until a named clinician has
   * attested to being within arm's reach (`SpotterService`), enforced both in
   * the app and - because an app is a client - on the clip upload.
   */
  /**
   * Named sub-phases inside one continuous recording. The step's
   * `durationSeconds` stays authoritative and must equal their sum, which
   * `BatteryService` checks at boot.
   */
  subBlocks?: BatterySubBlock[];
  requiresSpotter?: boolean;
  eyesClosed?: boolean;
  stance?: "bilateral" | "single_left" | "single_right";
  contraindications?: string[];
  symptomStopRules?: string[];
}

export interface AssessmentBattery {
  version: string;
  status: "draft" | "approved";
  steps: BatteryStep[];
}

export interface ReferenceEntry {
  metricKey: string;
  kind: "geometric" | "literature";
  value?: number;
  min?: number;
  max?: number;
  unit: string;
  sourceCitation: string;
  appliesTo?: string;
}

export interface ReferenceRangeSet {
  version: string;
  status: "draft" | "approved";
  reviewedBy: string | null;
  entries: ReferenceEntry[];
}

export type QualityReason =
  | "insufficient_landmarks"
  | "insufficient_scale"
  | "identity_uncertain"
  | "anchor_drift"
  | "low_confidence"
  | "occlusion"
  | "wrong_view"
  | "out_of_frame"
  | "camera_not_level"
  | "insufficient_frame_rate"
  | "insufficient_frames"
  | "subject_moving"
  // Depth reasons, quality-gate-flag/v1 (ADR-020). They apply only to
  // static3d.* results; a depth failure can never suppress a 2D result.
  | "depth_unavailable"
  | "insufficient_depth_samples"
  | "depth_landmark_disagreement"
  | "torso_plane_underdetermined";

export type Tier = "estimate" | "proxy" | "entered" | "annotated" | "not_measurable";
export type Side = "left" | "right" | "bilateral" | null;

export type MeasurementMethod = "mediapipe_2d_image_plane" | "clinician_manual" | "clinician_annotated" | "entered" | "markerless_3d" | "mediapipe_2_5d_depth";

export interface Provenance {
  schemaVersion: string;
  modelVersion: string;
  adapterVersion?: string;
  calibrationVersion: string;
  producedAt: string;
  metricsVersion?: string;
  referenceFileVersion?: string;
  clipSha256?: string;
  measurementMethod?: MeasurementMethod;
}

export interface MetricResult {
  resultId: string;
  sessionId: string;
  clipId?: string | null;
  stepId?: string | null;
  metricKey: string;
  module: "static" | "functional" | "gait" | "workstation" | "ergonomic";
  tier: Tier;
  unit: string;
  side: Side;
  estimate?: { value: number; uncertainty: number; framesUsed: number; signConvention?: string };
  unsupported?: { reasons: QualityReason[]; detail?: string };
  notMeasurable?: { reason: string; whatWouldBeNeeded: string };
  /**
   * tier "annotated": a value a named clinician produced by moving landmarks.
   * Always carries provenance.measurementMethod "clinician_annotated" (the
   * schema enforces it) and never an `estimate`.
   */
  annotated?: {
    value: number;
    uncertainty: number;
    annotatorId: string;
    annotatedAt: string;
    sourceResultId: string;
    sourceFrameIndex: number;
    adjustments: Array<{ landmark: string; fromPx: [number, number]; toPx: [number, number] }>;
  };
  evidence?: { frameIndices?: number[]; landmarkSeriesSha256?: string };
  provenance: Provenance;
}

/** GET /internal/metrics/catalog on ml-service (spec slice A). */
export interface MetricCatalog {
  metricsVersion: string;
  metrics: Array<{
    metricKey: string;
    label: string;
    module: string;
    tier: Tier;
    unit: string;
    side: string | null;
    signConvention: string;
    description: string;
    measurementMethod?: MeasurementMethod;
  }>;
  notMeasurable: Array<{ metricKey: string; label: string; reason: string; whatWouldBeNeeded: string }>;
}
