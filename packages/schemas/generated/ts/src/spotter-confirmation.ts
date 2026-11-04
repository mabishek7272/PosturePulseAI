/* eslint-disable */
/**
 * Generated from packages/schemas/src/spotter-confirmation.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * A named clinician's attestation that they are within arm's reach of the person for a specific assessment step, recorded before that step may be captured. The structural half of HZ-09 (induced fall / loss of balance): a step whose battery entry sets requiresSpotter cannot reach recording in the app, and its clip is refused by the server, until one of these exists for that session and step. It is an attestation by an identified person, not a dismissable prompt - which is why it carries confirmedBy and is authenticated with the clinician's own credentials rather than the subject session token the capture screen otherwise uses.
 */
export interface SpotterConfirmation {
  confirmationId: string;
  sessionId: string;
  /**
   * Confirmation is PER STEP, never per session: standing on one leg with eyes closed needs its own attestation, and a single session-wide tick would let one confirmation cover a step the clinician never saw.
   */
  stepId: string;
  confirmedAt: string;
  /**
   * The clinician's username, from their verified token - never client-supplied. Without an identified attester this record would say only that somebody tapped a button.
   */
  confirmedBy: string;
  /**
   * Always true. A 'no' is not a recordable state: it means the step does not run, so there is nothing to attest to and no record to write. Pinned by const so a false can never be stored and later read as a confirmation.
   */
  withinArmsReach: true;
  /**
   * Optional clinician note, e.g. a second person present.
   */
  note?: string | null;
}
