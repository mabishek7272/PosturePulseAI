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
 * Multipart upload of one clip plus its ClipCapture sidecar.
 *
 * `token` must be the SESSION token returned by POST /sessions, not the
 * clinician JWT: SessionOwnershipGuard requires role === "subject" matching
 * this session id and answers 403 for anything else.
 */
export async function uploadClip(input: {
  sessionId: string;
  stepId: string;
  videoPath: string;
  sidecar: ClipCapture;
  token: string;
}): Promise<{ clipId: string; status: string }> {
  const { extension, contentType } = clipMediaType(input.videoPath);

  const form = new FormData();
  form.append("clip", {
    uri: input.videoPath.startsWith("file://") ? input.videoPath : `file://${input.videoPath}`,
    name: `${input.stepId}.${extension}`,
    type: contentType,
  } as unknown as Blob);
  form.append("sidecar", JSON.stringify(input.sidecar));

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
