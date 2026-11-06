import type { ARJigRecordedClip } from "../../modules/ar-jig";
import {
  APP_VERSION,
  clipIdFor,
  InvalidFrameTimingError,
  MissingGravityError,
  type ClipCapture,
} from "./sidecar";

/**
 * Turns a clip from the AR jig native module into a `ClipCapture`
 * (packages/schemas/src/clip-capture.schema.json).
 *
 * Unlike `buildSidecar`, this does NOT interpolate gravity. The AVFoundation
 * path samples CoreMotion on its own clock and has to interpolate those samples
 * onto the file's frame times; ARKit instead reports the camera transform with
 * the very frame being encoded, so the module already emits one exact gravity
 * reading per encoded frame. Interpolating here would only blur data that is
 * already aligned.
 *
 * The checks below mirror `buildSidecar`'s: this is the last point before upload
 * at which a malformed sidecar can still be caught, and a wrong gravity vector
 * is silent — the server would trust it and mis-measure every angle.
 */
export function buildArJigSidecar(input: {
  sessionId: string;
  stepId: string;
  /** "anterior" | "posterior" | "left_lateral" | "right_lateral". */
  view: string;
  clip: ARJigRecordedClip;
  /** Per-recording token (`newTakeId`), so a rescanned view gets its own clipId. */
  take?: string;
}): ClipCapture {
  const { clip } = input;

  if (clip.frames.length === 0) throw new InvalidFrameTimingError();

  // `previousT` is carried rather than read back as `frames[i - 1].t`: frame 0
  // has no predecessor, and the indexed form only avoided reading one because of
  // an `i > 0` guard the type checker could not see.
  let previousT = Number.NEGATIVE_INFINITY;
  for (const [i, frame] of clip.frames.entries()) {
    if (frame.index !== i) {
      throw new InvalidFrameTimingError(
        `Frame ${i} reports index ${frame.index}; the sidecar and the video would not line up.`,
      );
    }

    const { t } = frame;
    if (!Number.isFinite(t) || t < 0 || t < previousT) {
      throw new InvalidFrameTimingError(
        `Frame ${i} has an invalid time (${t}); the video cannot be uploaded.`,
      );
    }
    previousT = t;

    // The module normalises gravity natively and omits any frame it could not
    // certify, so a non-unit vector here means something is wrong upstream.
    // Uploading it would be a fabricated measurement (CLAUDE.md rule 3).
    const [x, y, z] = frame.gravity;
    const magnitude = Math.hypot(x, y, z);
    if (!Number.isFinite(magnitude) || Math.abs(magnitude - 1) > 1e-3) {
      throw new MissingGravityError(
        `Frame ${i} has a non-unit gravity vector (magnitude ${magnitude}); the clip cannot be uploaded.`,
      );
    }
  }

  const depth = depthBlock(clip);

  return {
    clipId: clipIdFor(input.sessionId, input.stepId, input.take),
    sessionId: input.sessionId,
    stepId: input.stepId,
    view: input.view,
    recordedAt: clip.recordedAt,
    // Measured from the frames actually encoded, not the format requested.
    nominalFps: clip.nominalFps,
    width: clip.width,
    height: clip.height,
    frames: clip.frames.map((frame) => ({
      index: frame.index,
      t: frame.t,
      gravity: frame.gravity,
    })),
    // Sent as an explicit null when ARKit reported no usable resolution, rather
    // than omitted, so the server can tell "not reported" from "not supported".
    intrinsics: clip.intrinsics ?? null,
    // Spread so the key is absent when there is no depth track. An explicit
    // null or an empty block would both be wrong: the server rejects a declared
    // depth track whose file never arrives, and the file only travels when this
    // block does.
    ...(depth ? { depth } : {}),
    device: clip.device,
    provenance: {
      schemaVersion: "clip-capture/v0",
      // A distinct capture path deserves a distinct model version: these clips
      // carry ARKit-derived gravity and true intrinsics, not CoreMotion samples
      // interpolated onto frame times (CLAUDE.md rule 4 — provenance on every
      // record).
      modelVersion: `beaive-mobile-arjig/${APP_VERSION}`,
      calibrationVersion: clip.intrinsics ? "arkit-intrinsics/v0" : "none/v0",
      producedAt: new Date().toISOString(),
    },
  };
}

/**
 * The sidecar's `depth` block, or undefined when this clip has no usable depth
 * track.
 *
 * The native module has already derived every value from the bytes it wrote, so
 * nothing is recomputed here. What this does is refuse to describe a track that
 * cannot be described correctly, because the server checks each of these and a
 * declared-but-wrong block fails the whole upload - video included - while a
 * missing block costs only the depth.
 */
function depthBlock(clip: ARJigRecordedClip): ClipCapture["depth"] {
  const { depth } = clip;
  if (!depth) return undefined;

  // frameCount is what the server cross-checks against frames.length, and the
  // schema requires index 0..n-1 in order with t >= 0 and non-decreasing.
  if (depth.frameCount !== depth.frames.length || depth.frameCount === 0) return undefined;
  let previousDepthT = Number.NEGATIVE_INFINITY;
  for (const [i, frame] of depth.frames.entries()) {
    if (frame.index !== i) return undefined;
    if (!Number.isFinite(frame.t) || frame.t < 0) return undefined;
    if (frame.t < previousDepthT) return undefined;
    previousDepthT = frame.t;
  }
  if (!/^[0-9a-f]{64}$/.test(depth.sha256)) return undefined;
  if (!(depth.width >= 1 && depth.height >= 1)) return undefined;
  if (!(depth.nominalFps > 0)) return undefined;

  return {
    width: depth.width,
    height: depth.height,
    encoding: depth.encoding,
    scaleMillimetres: depth.scaleMillimetres,
    nominalFps: depth.nominalFps,
    frameCount: depth.frameCount,
    sha256: depth.sha256,
    hasConfidence: depth.hasConfidence,
    frames: depth.frames.map((frame) => ({ index: frame.index, t: frame.t })),
  };
}
