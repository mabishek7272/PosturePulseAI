import type { StyleProp, ViewStyle } from "react-native";

/**
 * Why the spatial gate is closed, in priority order (fix the camera before the
 * subject). These are machine codes: the native module ships no user-facing
 * wording, so all copy lives in React where `npm run lint:claims` can see it.
 *
 * `foreground_obstruction` means a surface nearer than the clearance threshold
 * occupies part of the central band. It is NOT person detection — LiDAR depth
 * alone cannot identify a person, and naming it "bystander" would claim a
 * measurement the pipeline does not make (CLAUDE.md rule 3).
 */
export type ARJigBlockerCode =
  | "tracking_unavailable"
  | "tracking_limited"
  | "no_floor_plane"
  | "camera_not_level"
  | "camera_too_low"
  | "camera_too_high"
  | "too_close"
  | "too_far"
  | "foreground_obstruction";

export type ARJigErrorCode =
  | "unsupported_device"
  | "session_not_ready"
  | "gate_closed"
  | "writer_failed"
  | "insufficient_frame_rate"
  | "halted";

/**
 * Published at ~12 Hz while the session runs.
 *
 * Every measurement is optional and is OMITTED when the device could not
 * produce it — never sent as 0 or NaN. Render a dash for `undefined`; do not
 * coalesce it to a number, or the HUD will show a reading that was never taken.
 */
export interface ARJigGateEvent {
  /** True only after every condition has held for `thresholds.stabilityHold`. */
  isOpen: boolean;
  isRecording: boolean;
  matPlaced: boolean;
  /** 0..1 progress through the stability hold. Pauses on a blip under 0.3 s; resets on a longer violation (ARJigStabiliser). */
  stabilityProgress: number;
  /** Frames dropped mid-take because their gravity could not be certified. */
  skippedFrames: number;
  blockers: ARJigBlockerCode[];
  primaryBlocker?: ARJigBlockerCode;
  /**
   * Tilt of the optical axis out of horizontal, degrees, unsigned: `asin(|g_z|)`.
   * ZERO means level. This matches the server's convention
   * (`services/ml-service/app/geometry/roll_correction.py`), which rejects a clip
   * whose median hold pitch exceeds 2 x the step's `levelToleranceDegrees` — 12
   * degrees for every step in the v0 battery.
   */
  pitchDegrees?: number;
  /** In-plane tilt against true vertical, degrees. Positive leans image-right. */
  rollDegrees?: number;
  /** Camera altitude above the detected floor plane, metres. */
  cameraHeight?: number;
  /** 3D camera-to-mat distance, metres. */
  distance?: number;
  /** Nearest surface in the central band, metres; absent when depth is unavailable. */
  nearestSurface?: number;
}

/** One entry per frame actually encoded, in order. */
export interface ARJigFrame {
  index: number;
  /** Seconds since the clip's first encoded frame. */
  t: number;
  /**
   * Unit gravity in the sidecar's camera frame C: x = image right, y = image
   * DOWN, z = optical axis away from the camera. A level camera filming upright
   * reports approximately [0, 1, 0].
   */
  gravity: [number, number, number];
}

/**
 * A finished clip. Turn it into a `ClipCapture`
 * (packages/schemas/src/clip-capture.schema.json) by adding the ids, the view
 * and the provenance the app owns — see src/capture/ar-jig-sidecar.ts.
 */
export interface ARJigRecordedClip {
  /** `file://` URL of the .mov, in the temporary directory. */
  videoPath: string;
  /** Encoded frame size as written, not the size requested. */
  width: number;
  height: number;
  /** Derived from the frames actually encoded, never from the requested format. */
  nominalFps: number;
  recordedAt: string;
  skippedFrames: number;
  frames: ARJigFrame[];
  /** True pinhole intrinsics, which the AVFoundation capture path cannot supply. */
  intrinsics?: { fx: number; fy: number; cx: number; cy: number };
  /**
   * The LiDAR depth track written alongside the video (ADR-020). OMITTED - not
   * null - when the device has no LiDAR, the writer failed, or the track could
   * not be described. Absent depth is a supported state end to end, so a caller
   * must never substitute an empty block for a missing one.
   */
  depth?: ARJigDepthTrack;
  device: { model: string; lens: "back_wide"; appVersion: string };
}

/**
 * The depth track's file plus everything the sidecar's `depth` block needs
 * (packages/schemas/src/clip-capture.schema.json).
 */
export interface ARJigDepthTrack {
  /** `file://` URL of the .depth file, in the temporary directory. */
  depthPath: string;
  width: number;
  height: number;
  /**
   * Raw DEFLATE (RFC 1951) per frame over little-endian uint16 millimetres -
   * planar depth along the optical axis, NOT range along the ray. 0 means "no
   * return", which is not 0 m.
   */
  encoding: "uint16_millimetres_deflate";
  scaleMillimetres: number;
  /** Derived from the frames actually written, never the rate requested. */
  nominalFps: number;
  frameCount: number;
  /** SHA-256 of the file, checked by the server before any byte is decoded. */
  sha256: string;
  /** True when each frame carries ARKit's confidenceMap after the depth plane. */
  hasConfidence: boolean;
  /**
   * One entry per depth frame written, in file order. `t` is seconds since the
   * clip's first ENCODED video frame, the same origin as `frames[].t`, so a
   * depth frame can be paired with a pose observation.
   *
   * Deliberately NOT index-aligned with `frames`: depth runs at ~15 Hz against
   * video at 30-60 Hz and frames drop, so gaps in `t` are real and must never be
   * interpolated.
   */
  frames: Array<{ index: number; t: number }>;
}

export interface ARJigCaptureErrorEvent {
  code: ARJigErrorCode;
  message: string;
}

/**
 * Gate thresholds. Every field is optional; omitted fields keep the native
 * defaults. Distances in metres, angles in degrees.
 *
 * These are engineering defaults, not values derived from clinical data —
 * expect to retune them against a real iPad Pro in a real clinic room.
 */
export interface ARJigThresholds {
  /** Default 3. Must stay below 12, the server's hard rejection limit. */
  maxPitchDegrees?: number;
  /** Default 2. Roll is corrected server-side, so this is a quality nicety. */
  maxRollDegrees?: number;
  /** Default 0.9. Camera altitude above the floor plane. */
  minCameraHeight?: number;
  /** Default 1.3. */
  maxCameraHeight?: number;
  /** Default 2.3. */
  minDistance?: number;
  /** Default 3.0. */
  maxDistance?: number;
  /** Default 2.5, where the mat is auto-placed. */
  idealDistance?: number;
  /** Default 1.5. Anything nearer in the central band fails the gate. */
  minSubjectClearance?: number;
  /** Default 0.02. Fraction of near depth pixels that counts as an obstruction. */
  maxForegroundFraction?: number;
  /** Default 1.5 seconds. */
  stabilityHold?: number;
}

export interface ARJigViewProps {
  style?: StyleProp<ViewStyle>;
  /**
   * Runs or pauses the ARSession. Pausing keeps the view mounted and the placed
   * mat intact, so a screen that loses focus does not lose the setup.
   */
  active?: boolean;
  /** Clip length in seconds. Recording stops itself at this point. Default 30. */
  clipSeconds?: number;
  /**
   * The step's minimum acceptable frame rate. A clip that comes in under this is
   * rejected locally with `insufficient_frame_rate` rather than uploaded with a
   * rate it never achieved. Default 24, matching the v0 battery.
   */
  minFps?: number;
  /** Average encoded bit rate. Default 6_000_000, matching the existing recorder. */
  bitRate?: number;
  thresholds?: ARJigThresholds;
  onGate?: (event: { nativeEvent: ARJigGateEvent }) => void;
  onRecordingProgress?: (event: { nativeEvent: { progress: number } }) => void;
  onRecorded?: (event: { nativeEvent: ARJigRecordedClip }) => void;
  onCaptureError?: (event: { nativeEvent: ARJigCaptureErrorEvent }) => void;
}

/** Imperative handle. All methods run on the native main queue. */
export interface ARJigViewRef {
  /** Rejected with `gate_closed` via `onCaptureError` if the gate is not open. */
  startRecording(): Promise<void>;
  /** Operator-initiated stop; keeps whatever was captured. */
  stopRecording(): Promise<void>;
  /**
   * ADR-005 safety stop (symptom report or contraindication): abandons the take
   * and deletes the partial file. Safety outranks capture progress, always.
   */
  halt(): Promise<void>;
  /** Re-places the mat straight ahead at the ideal distance. */
  placeMatAhead(): Promise<void>;
  clearMat(): Promise<void>;
}
