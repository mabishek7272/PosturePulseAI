/* eslint-disable */
/**
 * Generated from packages/schemas/src/reference-range-set.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * Versioned 'Theoretical Ideal' values for report rows (ADR-015). A draft set must not name a reviewer; only a clinical lead's sign-off turns it into an approved set. Proxy metrics never receive a literature reference for the construct they stand in for.
 */
export interface ReferenceRangeSet {
  /**
   * e.g. "posture-reference/v0-draft".
   */
  version: string;
  status: "draft" | "approved";
  reviewedBy: string | null;
  entries: {
    [k: string]: unknown;
  }[];
}
