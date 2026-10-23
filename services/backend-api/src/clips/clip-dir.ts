/** Shared volume that holds uploaded clips; the ml-service mounts the same path (ADR-013). */
export const DEFAULT_CLIP_DIR = "/data/clips";

export function clipDirFromEnv(): string {
  return process.env.CLIP_DIR || DEFAULT_CLIP_DIR;
}
