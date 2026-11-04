import type { ARJigBlockerCode, ARJigErrorCode } from "../../modules/ar-jig";

/**
 * All user-facing wording for the AR jig gate. The native module ships machine
 * codes only, so every sentence a patient or clinician reads lives here, in
 * React, where `npm run lint:claims` can see it.
 *
 * Rules these strings follow:
 *
 * - They describe **the camera or the room**, never the person's body. "Move the
 *   iPad further back" is setup instruction; "your posture is poor" would be a
 *   finding, and this screen makes no findings.
 * - `foreground_obstruction` is phrased as a nearby surface, not a bystander.
 *   LiDAR depth alone cannot identify a person, and saying "someone is standing
 *   too close" would claim a measurement the pipeline does not make (CLAUDE.md
 *   rule 3).
 * - Nothing here states an accuracy, a threshold as a clinical requirement, or
 *   any consequence for the result beyond "the clip was not kept".
 */
export const BLOCKER_TEXT: Record<ARJigBlockerCode, string> = {
  tracking_unavailable: "Hold the iPad still for a moment while it finds the room.",
  tracking_limited: "Move the iPad slowly - it is still mapping the room.",
  no_floor_plane: "Point the iPad at the floor for a moment so it can find it.",
  camera_not_level: "Tilt the iPad until it is upright.",
  camera_too_low: "Raise the iPad a little.",
  camera_too_high: "Lower the iPad a little.",
  too_close: "Move the iPad further back.",
  too_far: "Move the iPad closer.",
  foreground_obstruction: "Something is close to the camera - clear the space in front of it.",
};

/** Shown when the gate is open and the hold has completed. */
export const GATE_READY_TEXT = "Ready - the iPad is in position.";

/** Shown while the stability hold is counting, before the gate opens. */
export const GATE_SETTLING_TEXT = "Hold steady...";

/**
 * Capture failures. Each says what happened and what to do; none blames the
 * patient, and none claims the measurement would have been inaccurate - only
 * that no clip was kept.
 */
export const ERROR_TEXT: Record<ARJigErrorCode, string> = {
  unsupported_device: "This iPad cannot run the guided setup. The standard camera capture is used instead.",
  session_not_ready: "The camera is not ready yet. Try again in a moment.",
  gate_closed: "Get the iPad into position first - the prompt above says what to adjust.",
  writer_failed: "The recording could not be saved. Nothing was kept; please try again.",
  insufficient_frame_rate:
    "The recording dropped too many frames to be used, so it was not kept. Please record it again.",
  halted: "The recording was stopped and nothing was kept.",
};

/** The one blocker to show, or null when the gate is clear. */
export function primaryBlockerText(
  blockers: ARJigBlockerCode[],
  primary: ARJigBlockerCode | undefined,
): string | null {
  // The native module already orders blockers by priority (fix the camera
  // before the room), so the first one is the one to act on. Showing all of
  // them at once gives the operator nothing to do first.
  const code = primary ?? blockers[0];
  return code ? BLOCKER_TEXT[code] : null;
}
