import { required } from "../lib/required";
import type { GravitySample, Vector3 } from "./gravity";

export const APP_VERSION = "1.0.0";
const MODEL_VERSION = `beaive-mobile/${APP_VERSION}`;

/**
 * Thrown when a clip was recorded without any usable gravity reading.
 * CLAUDE.md rule 3: never fabricate a measurement. A sidecar full of zeros
 * would tell the server the phone was in free fall, silently corrupting every
 * angle - so the upload must fail loudly instead.
 */
export class MissingGravityError extends Error {
  constructor(
    message = "No gravity readings were captured for this clip; it cannot be uploaded.",
  ) {
    super(message);
  }
}

/**
 * The server stores the clip under this id as both its primary key and its
 * filename, and accepts only 1-64 letters, digits, '-' or '_' (SAFE_CLIP_ID in
 * clips.service.ts). Step ids contain dots ("static.anterior"), so they are
 * mapped to underscores; a raw `${sessionId}-${stepId}` is rejected with a 400.
 */
export function clipIdFor(sessionId: string, stepId: string): string {
  return `${sessionId}-${stepId.replace(/\./g, "_")}`;
}

/** The sub-phases of a multi-block hold (assessment-battery.schema.json). */
export type SubPhase = "relaxed" | "habitual" | "standardized";

export interface ClipCapture {
  clipId: string;
  sessionId: string;
  stepId: string;
  view: string;
  recordedAt: string;
  nominalFps: number;
  width: number;
  height: number;
  frames: Array<{ index: number; t: number; gravity: Vector3; subPhase?: SubPhase }>;
  /**
   * Pinhole intrinsics in pixels for the oriented image, when the device reports
   * them. The AVFoundation capture path does not, so it omits this; the AR jig
   * path does (ARKit gives true intrinsics). Optional in
   * clip-capture.schema.json.
   */
  intrinsics?: { fx: number; fy: number; cx: number; cy: number } | null;
  /**
   * The LiDAR depth track uploaded alongside the clip (ADR-020). OMITTED when
   * there is none - never sent as null or as an empty block, because the server
   * rejects a declared depth track with no file. The AVFoundation path never
   * sets it.
   */
  depth?: ClipCaptureDepth;
  device: { model: string; lens: "back_wide" | "back_ultrawide" | "front"; appVersion: string };
  provenance: {
    schemaVersion: string;
    modelVersion: string;
    calibrationVersion: string;
    producedAt: string;
  };
}

/**
 * The sidecar's description of the depth track. Exactly the schema's `depth`
 * block - `depthPath` is NOT part of it: the file travels as its own multipart
 * part, and the server assigns its own storage path.
 */
export interface ClipCaptureDepth {
  width: number;
  height: number;
  encoding: "uint16_millimetres_deflate";
  scaleMillimetres: number;
  nominalFps: number;
  frameCount: number;
  sha256: string;
  hasConfidence: boolean;
  frames: Array<{ index: number; t: number }>;
}

/**
 * Thrown when the recorded file's frame timing is unusable (no frames, or a
 * non-finite / decreasing time). The sidecar's frames must describe the frames
 * that were really encoded, so there is nothing safe to fall back to.
 */
export class InvalidFrameTimingError extends Error {
  constructor(message = "The recorded video has no usable frame timing; it cannot be uploaded.") {
    super(message);
    this.name = "InvalidFrameTimingError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface BuildSidecarInput {
  clipId: string;
  sessionId: string;
  stepId: string;
  view: string;
  recordedAt: string;
  /** Nominal (selected) frame rate; informational only, frame timing comes from `frameTimes`. */
  fps: number;
  /** ORIENTED width of the recorded file (see readVideoInfo), not the requested resolution. */
  width: number;
  /** ORIENTED height of the recorded file. */
  height: number;
  /**
   * One presentation time in seconds per frame actually encoded in the file,
   * in presentation order, first frame at 0 (see readVideoInfo). The server
   * pairs decoded frame i with sidecar frame i and uses these as timestamps.
   */
  frameTimes: number[];
  /**
   * One entry per frame, aligned with `frameTimes`, naming the sub-phase that
   * frame fell in. Omit for an ordinary single-phase hold.
   *
   * Computed at capture time by `sub-blocks.tagFrames` from the REAL frame
   * timestamps, never from the declared durations: a split inferred later
   * drifts with every dropped frame, and a frame attributed to the wrong phase
   * is a measurement of the wrong thing rather than a missing one.
   */
  subPhases?: Array<SubPhase | undefined>;
  gravitySamples: GravitySample[];
  device: ClipCapture["device"];
}

function normalise(v: Vector3): Vector3 {
  const magnitude = Math.hypot(v[0], v[1], v[2]);
  if (magnitude < 1e-9) throw new MissingGravityError();
  return [v[0] / magnitude, v[1] / magnitude, v[2] / magnitude];
}

/** Linear interpolation between the two samples bracketing `t`, clamped at both ends. */
function gravityAt(samples: GravitySample[], t: number): Vector3 {
  const first = samples[0];
  const last = samples[samples.length - 1];
  // `buildSidecar` rejects an empty sample list before this is reached, so
  // reaching the throw means that guard was bypassed. It is the same rejection
  // (no upload) rather than the TypeError an empty array used to produce.
  if (!first || !last) throw new MissingGravityError();
  if (t <= first.t) return normalise(first.g);
  if (t >= last.t) return normalise(last.g);

  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!a || !b) break; // unreachable: 1 <= i < samples.length
    if (b.t < t) continue;
    const span = b.t - a.t;
    const ratio = span <= 0 ? 0 : (t - a.t) / span;
    return normalise([
      a.g[0] + (b.g[0] - a.g[0]) * ratio,
      a.g[1] + (b.g[1] - a.g[1]) * ratio,
      a.g[2] + (b.g[2] - a.g[2]) * ratio,
    ]);
  }
  return normalise(last.g);
}

/** Clips longer than this must have gravity samples covering most of the recording. */
const COVERAGE_CHECK_MIN_DURATION_S = 1.5;
const MIN_COVERAGE_FRACTION = 0.5;

export function buildSidecar(input: BuildSidecarInput): ClipCapture {
  if (input.gravitySamples.length === 0) throw new MissingGravityError();

  const { frameTimes } = input;
  if (frameTimes.length === 0) throw new InvalidFrameTimingError();
  // Iterated with a running `previous` rather than `frameTimes[i - 1]`: the
  // indexed form read `undefined` on frame 0, and only the `i > 0` guard kept
  // that comparison from running.
  let previous = Number.NEGATIVE_INFINITY;
  for (const [i, t] of frameTimes.entries()) {
    if (!Number.isFinite(t) || t < 0 || t < previous) {
      throw new InvalidFrameTimingError(`Frame ${i} has an invalid time (${t}); the video cannot be uploaded.`);
    }
    previous = t;
  }
  // Non-empty: checked above.
  const durationSeconds = required(frameTimes[frameTimes.length - 1], "frameTimes is non-empty");

  // Sort a copy by time. gravityAt assumes ascending t; out-of-order samples
  // (e.g. Date.now() stepping backwards under an NTP adjustment) would
  // otherwise interpolate against the wrong neighbour and produce a
  // plausible-looking but wrong gravity vector.
  const samples = [...input.gravitySamples].sort((a, b) => a.t - b.t);

  // One sample (or a burst covering a sliver of the clip) held across the whole
  // recording would be fabricated per-frame data (CLAUDE.md rule 3).
  if (durationSeconds > COVERAGE_CHECK_MIN_DURATION_S) {
    const earliest = required(samples[0], "gravitySamples is non-empty");
    const latest = required(samples[samples.length - 1], "gravitySamples is non-empty");
    const span = latest.t - earliest.t;
    if (samples.length < 2 || span < durationSeconds * MIN_COVERAGE_FRACTION) {
      throw new MissingGravityError(
        `Gravity readings cover only ${span.toFixed(2)}s of a ${durationSeconds.toFixed(2)}s clip; it cannot be uploaded.`,
      );
    }
  }

  // One entry per frame actually encoded, at its real time: never a count or
  // spacing derived from duration * fps.
  const frames = frameTimes.map((t, index) => {
    const frame: ClipCapture["frames"][number] = { index, t, gravity: gravityAt(samples, t) };
    // Omitted, never nulled: the schema has no null for this, and a frame
    // outside every sub-block window genuinely has no phase.
    const phase = input.subPhases?.[index];
    if (phase) frame.subPhase = phase;
    return frame;
  });

  return {
    clipId: input.clipId,
    sessionId: input.sessionId,
    stepId: input.stepId,
    view: input.view,
    recordedAt: input.recordedAt,
    nominalFps: input.fps,
    width: input.width,
    height: input.height,
    frames,
    device: input.device,
    provenance: {
      schemaVersion: "clip-capture/v0",
      modelVersion: MODEL_VERSION,
      // No camera calibration is performed in P1; the server is told so
      // explicitly rather than left to infer it.
      calibrationVersion: "none/v0",
      producedAt: new Date().toISOString(),
    },
  };
}
