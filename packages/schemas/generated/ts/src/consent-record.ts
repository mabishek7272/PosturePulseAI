/* eslint-disable */
/**
 * Generated from packages/schemas/src/consent-record.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * Consent scope for a pseudonymous subject (PRD 1.6, TRD 2.4). Default scope is derived-event retention only; raw video is opt-in.
 */
export interface ConsentRecord {
  consentRecordId: string;
  /**
   * Pseudonymous subject identifier - never a direct identifier (name, email, national ID).
   */
  subjectPseudoId: string;
  /**
   * @minItems 1
   */
  scopes: [
    "derived_events" | "raw_video" | "research_data_export" | "wearable_integration",
    ...("derived_events" | "raw_video" | "research_data_export" | "wearable_integration")[]
  ];
  grantedAt: string;
  revokedAt?: string | null;
  withdrawalRequestedAt?: string | null;
  /**
   * Optional. The patient's and the supervising clinician's handwritten signatures, captured on the clinic device before the first recording. Stored encrypted server-side; never returned by the unauthenticated consent routes.
   */
  signatures?: {
    subject: {
      /**
       * The strokes as one SVG path string (M/L/Q/l commands and numbers only), in signature-pad pixels.
       */
      svgPath: string;
      signedAt: string;
    };
    clinician: {
      /**
       * The strokes as one SVG path string (M/L/Q/l commands and numbers only), in signature-pad pixels.
       */
      svgPath: string;
      signedAt: string;
    };
  };
}
