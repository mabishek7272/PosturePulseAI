import { File } from "expo-file-system";
import type { ClipCapture } from "../capture/sidecar";
import { assertOk } from "./http";
import { BACKEND_URL } from "./config";

/**
 * iOS records .mov, Android always records .mp4 and ignores the recorder's
 * fileType option. The server accepts both, so a hardcoded type would not be
 * rejected - it would store a mislabelled file the analyser then fails to
 * decode. Derive it from what was actually written.
 */
export function clipMediaType(videoPath: string): {
  extension: "mp4" | "mov";
  contentType: string;
} {
  const isMp4 = videoPath.split(".").pop()?.toLowerCase() === "mp4";
  return isMp4
    ? { extension: "mp4", contentType: "video/mp4" }
    : { extension: "mov", contentType: "video/quicktime" };
}

/**
 * Multipart upload of one clip, its ClipCapture sidecar, and - when the AR jig
 * captured one - the LiDAR depth track (ADR-020).
 *
 * `token` must be the SESSION token returned by POST /sessions, not the
 * clinician JWT: SessionOwnershipGuard requires role === "subject" matching
 * this session id and answers 403 for anything else.
 *
 * The `depth` part and the sidecar's `depth` block travel together or not at
 * all: the server rejects either one without the other, because a declared
 * track that never arrived would make the analyser read a missing file and an
 * undeclared one has no encoding, scale or timing to be read by. `depthPath` is
 * therefore only ever passed alongside a sidecar that describes it.
 */
export async function uploadClip(input: {
  sessionId: string;
  stepId: string;
  videoPath: string;
  sidecar: ClipCapture;
  /** `file://` path of the .depth file; omitted when the clip has no depth. */
  depthPath?: string;
  token: string;
}): Promise<{ clipId: string; status: string }> {
  const { extension, contentType } = clipMediaType(input.videoPath);

  // Expo's fetch (SDK 58) rejects React Native's `{ uri, name, type }` file
  // object with "Unsupported FormDataPart implementation"; it only accepts a
  // part that exposes bytes(). Name and type stay explicit so the server
  // still sees the real content type rather than one guessed from the path.
  const file = new File(input.videoPath.startsWith("file://") ? input.videoPath : `file://${input.videoPath}`);
  const form = new FormData();
  form.append("clip", {
    name: `${input.stepId}.${extension}`,
    type: contentType,
    bytes: () => file.bytes(),
  } as unknown as Blob);
  form.append("sidecar", JSON.stringify(input.sidecar));

  // Sent only when the sidecar describes it, so the two can never disagree -
  // including when a caller passes a path for a clip whose depth block was
  // dropped as undescribable.
  if (input.depthPath && input.sidecar.depth) {
    const depthFile = new File(
      input.depthPath.startsWith("file://") ? input.depthPath : `file://${input.depthPath}`
    );
    form.append("depth", {
      name: `${input.stepId}.depth`,
      type: "application/octet-stream",
      bytes: () => depthFile.bytes(),
    } as unknown as Blob);
  }

  const response = await fetch(
    `${BACKEND_URL}/sessions/${encodeURIComponent(input.sessionId)}/clips/${encodeURIComponent(input.stepId)}`,
    {
      method: "PUT",
      // Content-Type is deliberately omitted: fetch must set the multipart
      // boundary itself, and setting it by hand breaks the upload.
      headers: { Authorization: `Bearer ${input.token}` },
      body: form,
    }
  );

  await assertOk(response);
  return (await response.json()) as { clipId: string; status: string };
}
