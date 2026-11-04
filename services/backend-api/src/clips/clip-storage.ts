import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { clipDirFromEnv } from "./clip-dir";

// multer's StorageEngine, typed locally (@types/multer is not a dependency).
interface IncomingFile {
  fieldname: string;
  stream: NodeJS.ReadableStream & { resume(): void };
}
type Done = (error: Error | null, info?: Record<string, unknown>) => void;

export const MAX_SIDECAR_BYTES = 5 * 1024 * 1024;

export function incomingDir(): string {
  return path.join(clipDirFromEnv(), "incoming");
}

/**
 * The `clip` and `depth` parts stream to CLIP_DIR/incoming (never held in
 * memory - the depth track is tens of megabytes); a `sidecar` sent as a file
 * part is small JSON and is buffered (capped). Any other file part is refused.
 */
export class ClipUploadStorage {
  _handleFile(_req: unknown, file: IncomingFile, cb: Done): void {
    if (file.fieldname === "clip" || file.fieldname === "depth") {
      const dir = incomingDir();
      mkdirSync(dir, { recursive: true });
      const target = path.join(dir, randomUUID());
      const out = createWriteStream(target);
      file.stream.pipe(out as never);
      out.on("error", (e) => cb(e));
      out.on("finish", () => cb(null, { path: target, size: out.bytesWritten }));
      return;
    }
    if (file.fieldname === "sidecar") {
      const chunks: Buffer[] = [];
      let size = 0;
      file.stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_SIDECAR_BYTES) {
          file.stream.resume();
          cb(new Error("The sidecar is too large."));
          return;
        }
        chunks.push(chunk);
      });
      file.stream.on("error", (e: Error) => cb(e));
      file.stream.on("end", () => {
        if (size <= MAX_SIDECAR_BYTES) cb(null, { buffer: Buffer.concat(chunks), size });
      });
      return;
    }
    file.stream.resume();
    cb(new Error(`Unexpected file part "${file.fieldname}".`));
  }

  _removeFile(_req: unknown, file: { path?: string }, cb: (error: Error | null) => void): void {
    if (!file.path) return cb(null);
    import("node:fs/promises").then(({ rm }) => rm(file.path as string, { force: true })).then(() => cb(null), cb);
  }
}
