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

export interface ClipCapture {
  clipId: string;
  sessionId: string;
  stepId: string;
  view: string;
  recordedAt: string;
  nominalFps: number;
  width: number;
  height: number;
  frames: Array<{ index: number; t: number; gravity: Vector3 }>;
  device: { model: string; lens: "back_wide" | "back_ultrawide" | "front"; appVersion: string };
  provenance: {
    schemaVersion: string;
    modelVersion: string;
    calibrationVersion: string;
    producedAt: string;
  };
}

export interface BuildSidecarInput {
  clipId: string;
  sessionId: string;
  stepId: string;
  view: string;
  recordedAt: string;
  fps: number;
  width: number;
  height: number;
  durationSeconds: number;
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
  if (t <= samples[0].t) return normalise(samples[0].g);
  const last = samples[samples.length - 1];
  if (t >= last.t) return normalise(last.g);

  for (let i = 1; i < samples.length; i += 1) {
    const b = samples[i];
    if (b.t < t) continue;
    const a = samples[i - 1];
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

  // Sort a copy by time. gravityAt assumes ascending t; out-of-order samples
  // (e.g. Date.now() stepping backwards under an NTP adjustment) would
  // otherwise interpolate against the wrong neighbour and produce a
  // plausible-looking but wrong gravity vector.
  const samples = [...input.gravitySamples].sort((a, b) => a.t - b.t);

  // One sample (or a burst covering a sliver of the clip) held across the whole
  // recording would be fabricated per-frame data (CLAUDE.md rule 3).
  if (input.durationSeconds > COVERAGE_CHECK_MIN_DURATION_S) {
    const span = samples[samples.length - 1].t - samples[0].t;
    if (samples.length < 2 || span < input.durationSeconds * MIN_COVERAGE_FRACTION) {
      throw new MissingGravityError(
        `Gravity readings cover only ${span.toFixed(2)}s of a ${input.durationSeconds.toFixed(2)}s clip; it cannot be uploaded.`,
      );
    }
  }

  // Frame count comes from the clip's real duration and frame rate - never a
  // fixed assumption, because recordings are rarely exactly the requested length.
  const frameCount = Math.max(1, Math.round(input.durationSeconds * input.fps));
  const frames = Array.from({ length: frameCount }, (_unused, index) => {
    const t = index / input.fps;
    return { index, t, gravity: gravityAt(samples, t) };
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
