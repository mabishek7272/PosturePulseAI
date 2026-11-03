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

export const CLIP_SECONDS = 3;
