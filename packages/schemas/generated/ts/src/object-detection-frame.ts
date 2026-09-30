/* eslint-disable */
/**
 * Generated from packages/schemas/src/object-detection-frame.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * Generic person/object detections (TRD 2.2). This is a generic COCO-class detector, NOT a desk/chair/monitor-specific ergonomic classifier - that needs a task-specific labeled model and is explicitly deferred (docs/adr/006-object-detection-scope.md). Bounding boxes are 2D image-pixel coordinates only; no 3D/workstation-object-frame localization is performed in this phase.
 */
export interface ObjectDetectionFrame {
  detectionFrameId: string;
  sessionId: string;
  capturedAt: string;
  /**
   * Always 'I' (image pixels) in this phase - see description above.
   */
  frame: "I" | "C" | "W" | "B" | "O";
  detections: {
    label:
      | "person"
      | "chair"
      | "couch"
      | "dining_table"
      | "tv"
      | "laptop"
      | "keyboard"
      | "mouse"
      | "cell_phone"
      | "book"
      | "bottle"
      | "cup";
    boundingBox: {
      xMin: number;
      yMin: number;
      xMax: number;
      yMax: number;
    };
    confidence: number;
  }[];
  /**
   * Per-record provenance so every event self-reports the versions that produced it (TRD traceability requirement).
   */
  provenance: {
    /**
     * Version of this record's own JSON Schema, e.g. "pose-landmark-frame/v0".
     */
    schemaVersion: string;
    /**
     * Identifier+version of the model/adapter that produced this record, e.g. "mediapipe-pose/0.10.9".
     */
    modelVersion: string;
    adapterVersion?: string;
    /**
     * Identifier of the camera calibration record in effect when this record was produced.
     */
    calibrationVersion: string;
    producedAt: string;
  };
}
