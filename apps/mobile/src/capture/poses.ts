export interface Pose {
  stepId: string;
  view: string;
  title: string;
  instruction: string;
  /** Two plain coaching reminders shown as chips. Not measurements. */
  cues: [string, string];
}

/**
 * Step ids must match the assessment battery the server returns. They are
 * listed here so capture can run in a fixed order; the titles shown come from
 * the battery when it loads.
 */
/**
 * FALLBACK ONLY. The live sequence comes from the battery the server returns
 * (`capture/battery-steps.ts`); this is what the app uses when that cannot be
 * fetched, and the capture screen says so on screen when it does.
 *
 * Step ids must match the assessment battery.
 */
export const POSES: Pose[] = [
  {
    stepId: "static.anterior",
    view: "anterior",
    title: "Facing the camera",
    instruction: "Stand facing the camera, feet hip-width apart, arms relaxed by your sides.",
    cues: ["Feet hip-width", "Gaze level"],
  },
  {
    stepId: "static.left_lateral",
    view: "left_lateral",
    title: "Left side to camera",
    instruction: "Turn so your left side faces the camera. Look straight ahead, arms relaxed.",
    cues: ["Eyes straight ahead", "Arms relaxed"],
  },
  {
    stepId: "static.right_lateral",
    view: "right_lateral",
    title: "Right side to camera",
    instruction: "Turn so your right side faces the camera. Look straight ahead, arms relaxed.",
    cues: ["Eyes straight ahead", "Arms relaxed"],
  },
  {
    stepId: "static.posterior",
    view: "posterior",
    title: "Back to the camera",
    instruction: "Turn your back to the camera, feet hip-width apart, arms relaxed.",
    cues: ["Feet hip-width", "Head level"],
  },
];

/**
 * Two plain coaching reminders per step, shown as chips.
 *
 * Kept HERE, in the app, rather than in the battery: they are UI copy, and
 * `scripts/lint-claims.sh` scans this file. A step the battery adds without a
 * local entry simply shows no chips, which is the right failure - inventing
 * coaching wording for a clinician-authored step would be putting words in
 * their mouth.
 */
export const CUES_BY_STEP: Record<string, readonly string[]> = Object.fromEntries(
  POSES.map((pose) => [pose.stepId, pose.cues])
);

/**
 * Length of every assessment clip, in seconds. The clinician wants 30 s
 * holds; change it here and the recorder limit and on-screen copy follow.
 * Keep the capture bit rate (capture.tsx TARGET_BIT_RATE) in step: file size is
 * roughly bit rate * CLIP_SECONDS / 8, and the server's upload limit applies.
 */
/**
 * DEPRECATED as the capture duration. Each step's own `durationSeconds` from the
 * battery is authoritative - see `capture/battery-steps.ts`. This constant
 * survives only as the fallback value used when the battery is unreachable, and
 * as the encoder's file-size budget reference.
 */
export const CLIP_SECONDS = 30;
