import { File, FileMode } from "expo-file-system";
import { readVideoInfo, VideoInfoError, type ByteSource, type VideoInfo } from "./video-info";

/**
 * Thin expo-file-system adapter for readVideoInfo: random-access partial
 * reads, so only the box headers and the 'moov' box are ever loaded, never the
 * clip's 'mdat'. All parsing lives (and is tested) in video-info.ts.
 */
export async function readVideoInfoFromFile(path: string): Promise<VideoInfo> {
  const uri = path.startsWith("file://") ? path : `file://${path}`;
  let handle: ReturnType<File["open"]>;
  try {
    handle = new File(uri).open(FileMode.ReadOnly);
  } catch (err) {
    throw new VideoInfoError("unreadable", err instanceof Error ? err.message : "could not open the recorded video");
  }
  try {
    const size = handle.size;
    if (size === null || size === undefined) throw new VideoInfoError("unreadable", "could not determine the video file size");
    const source: ByteSource = {
      size,
      read: async (offset, length) => {
        handle.offset = offset;
        return handle.readBytes(length);
      },
    };
    return await readVideoInfo(source);
  } finally {
    handle.close();
  }
}
