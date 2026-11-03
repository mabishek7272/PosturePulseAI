/**
 * Reads what the recorded clip ACTUALLY contains, straight from its ISO-BMFF
 * (.mov / .mp4) metadata: the oriented image size and one presentation time
 * per encoded frame.
 *
 * Why this exists: the server (ml-service app/clips/pose_video.py) decodes the
 * clip with PyAV, applies the container's display-matrix rotation, and rejects
 * the whole clip if the oriented frame size differs from the sidecar's
 * width x height; it then pairs decoded frame i with sidecar frame i and uses
 * the sidecar's `t` as that frame's timestamp. The sidecar therefore has to be
 * built from the file, not from the resolution we asked the camera for or from
 * duration * fps (CLAUDE.md rule 3: never fabricate a measurement).
 *
 * Choices (all mirror what FFmpeg/PyAV produce, verified against ffprobe and
 * PyAV on the fixtures in __fixtures__/):
 *  - Size: width/height of the video sample entry (stsd), swapped when the
 *    track's display matrix is a +-90 degree rotation. PyAV's frame.rotation +
 *    apply_rotation only ever swap axes for odd quarter turns.
 *  - Times: PyAV's container.decode() yields frames in PRESENTATION order, and
 *    the server pairs the i-th decoded frame with the i-th sidecar entry, so
 *    entry i carries the i-th smallest presentation time (dts from stts plus
 *    the signed composition offset from ctts, sorted), rebased so the first
 *    frame is t = 0 (the gravity samples are also measured from recording
 *    start). Without B-frames this is plain decode order.
 *  - Anything unexpected (fragmented files, edit lists that would drop frames,
 *    non-quarter-turn rotation, inconsistent sample tables, truncation) throws
 *    a typed VideoInfoError. Nothing is guessed.
 */

export type VideoInfoErrorCode =
  | "unreadable" // could not read bytes from the file
  | "not_isobmff" // not an ISO-BMFF container at all
  | "no_moov" // no movie box found
  | "truncated" // a box or table runs past the available bytes
  | "malformed" // structurally invalid or self-inconsistent
  | "no_video_track"
  | "unsupported"; // valid, but something we refuse to interpret

export class VideoInfoError extends Error {
  readonly code: VideoInfoErrorCode;
  constructor(code: VideoInfoErrorCode, message: string) {
    super(message);
    this.name = "VideoInfoError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface VideoInfo {
  /** Oriented (display) width in pixels: what the server's decoded frames will have. */
  width: number;
  /** Oriented (display) height in pixels. */
  height: number;
  /** Width/height as stored in the sample entry, before rotation. */
  codedWidth: number;
  codedHeight: number;
  /** Display-matrix rotation as FFmpeg reports it: 0, 90, 180 or 270 (counterclockwise). */
  rotationDegrees: 0 | 90 | 180 | 270;
  /** Sample-entry fourcc, e.g. "avc1" or "hvc1". */
  codec: string;
  /** One time in seconds per encoded frame, in presentation order, first frame = 0. */
  frameTimes: number[];
  /** Media timescale (ticks per second). */
  timescale: number;
}

export interface ByteSource {
  size: number;
  /** Reads up to `length` bytes at `offset`; may return fewer only at end of file. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** An in-memory ByteSource (tests, small files). */
export function bufferSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read: async (offset, length) => bytes.subarray(offset, Math.min(bytes.length, offset + length)),
  };
}

// A real moov for a 60 s clip is ~100 KB; anything this large is not a clip we recorded.
const MAX_MOOV_BYTES = 32 * 1024 * 1024;
const MAX_SAMPLES = 1_000_000;

// ---------------------------------------------------------------- box walking

interface Box {
  type: string;
  /** Offset of the payload (after the header) within the buffer. */
  start: number;
  /** Offset one past the end of the box within the buffer. */
  end: number;
}

function fourcc(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

function viewOf(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

function u64(v: DataView, o: number): number {
  const hi = v.getUint32(o);
  const lo = v.getUint32(o + 4);
  const n = hi * 4294967296 + lo;
  if (!Number.isSafeInteger(n)) throw new VideoInfoError("malformed", "64-bit value too large");
  return n;
}

/** Child boxes in buf[start, end). */
function children(buf: Uint8Array, start: number, end: number): Box[] {
  const v = viewOf(buf);
  const out: Box[] = [];
  let o = start;
  while (o < end) {
    if (end - o < 8) throw new VideoInfoError("truncated", "box header runs past its parent");
    let size = v.getUint32(o);
    const type = fourcc(buf, o + 4);
    let header = 8;
    if (size === 1) {
      if (end - o < 16) throw new VideoInfoError("truncated", "64-bit box header runs past its parent");
      size = u64(v, o + 8);
      header = 16;
    } else if (size === 0) {
      size = end - o; // extends to the end of the parent
    }
    if (size < header) throw new VideoInfoError("malformed", `box '${type}' has size ${size}`);
    if (o + size > end) throw new VideoInfoError("truncated", `box '${type}' runs past its parent`);
    out.push({ type, start: o + header, end: o + size });
    o += size;
  }
  return out;
}

function find(buf: Uint8Array, parent: { start: number; end: number }, type: string): Box | undefined {
  return children(buf, parent.start, parent.end).find((b) => b.type === type);
}

function need(buf: Uint8Array, parent: { start: number; end: number }, type: string): Box {
  const box = find(buf, parent, type);
  if (!box) throw new VideoInfoError("malformed", `missing '${type}' box`);
  return box;
}

function requireBytes(box: Box, n: number, what: string): void {
  if (box.end - box.start < n) throw new VideoInfoError("truncated", `'${what}' box is too short`);
}

// -------------------------------------------------------------------- parsing

/** FFmpeg's av_display_rotation_get(): counterclockwise degrees, or null if not a pure rotation. */
function rotationFromMatrix(m: number[]): number | null {
  const scale0 = Math.hypot(m[0], m[3]);
  const scale1 = Math.hypot(m[1], m[4]);
  if (scale0 === 0 || scale1 === 0) return null;
  return -(Math.atan2(m[1] / scale1, m[0] / scale0) * 180) / Math.PI;
}

function quarterTurnRotation(m: number[]): 0 | 90 | 180 | 270 {
  const degrees = rotationFromMatrix(m);
  if (degrees === null) throw new VideoInfoError("unsupported", "video track has a degenerate display matrix");
  const quarters = degrees / 90;
  const rounded = Math.round(quarters);
  if (Math.abs(quarters - rounded) > 0.01) {
    throw new VideoInfoError("unsupported", `video track rotation ${degrees.toFixed(2)} is not a multiple of 90 degrees`);
  }
  return ((((rounded % 4) + 4) % 4) * 90) as 0 | 90 | 180 | 270;
}

function parseTkhdMatrix(buf: Uint8Array, tkhd: Box): number[] {
  const version = buf[tkhd.start];
  const matrixAt = tkhd.start + (version === 1 ? 52 : 40);
  requireBytes(tkhd, matrixAt + 36 - tkhd.start, "tkhd");
  const v = viewOf(buf);
  const m: number[] = [];
  for (let i = 0; i < 9; i += 1) m.push(v.getInt32(matrixAt + i * 4));
  return m;
}

function parseMdhdTimescale(buf: Uint8Array, mdhd: Box): number {
  const version = buf[mdhd.start];
  const at = mdhd.start + (version === 1 ? 20 : 12);
  requireBytes(mdhd, at + 4 - mdhd.start, "mdhd");
  const timescale = viewOf(buf).getUint32(at);
  if (timescale === 0) throw new VideoInfoError("malformed", "mdhd timescale is 0");
  return timescale;
}

function parseSampleEntry(buf: Uint8Array, stsd: Box): { codec: string; width: number; height: number } {
  requireBytes(stsd, 8, "stsd");
  const v = viewOf(buf);
  const count = v.getUint32(stsd.start + 4);
  if (count < 1) throw new VideoInfoError("malformed", "stsd has no sample entries");
  const entries = children(buf, stsd.start + 8, stsd.end);
  if (entries.length !== count) throw new VideoInfoError("malformed", "stsd entry count does not match its contents");
  if (count > 1) throw new VideoInfoError("unsupported", "video track has several sample descriptions");
  const e = entries[0];
  // VisualSampleEntry: 6 reserved + 2 data_reference_index + 16 pre_defined/reserved, then width, height.
  requireBytes(e, 24 + 4, "visual sample entry");
  const width = v.getUint16(e.start + 24);
  const height = v.getUint16(e.start + 26);
  if (width === 0 || height === 0) throw new VideoInfoError("malformed", "sample entry has a zero dimension");
  return { codec: fourcc(buf, e.start - 4), width, height };
}

function parseStts(buf: Uint8Array, stts: Box): number[] {
  requireBytes(stts, 8, "stts");
  const v = viewOf(buf);
  const entryCount = v.getUint32(stts.start + 4);
  requireBytes(stts, 8 + entryCount * 8, "stts");
  const dts: number[] = [];
  let t = 0;
  for (let i = 0; i < entryCount; i += 1) {
    const count = v.getUint32(stts.start + 8 + i * 8);
    const delta = v.getUint32(stts.start + 12 + i * 8);
    if (dts.length + count > MAX_SAMPLES) throw new VideoInfoError("unsupported", "too many video samples");
    for (let k = 0; k < count; k += 1) {
      dts.push(t);
      t += delta;
    }
  }
  return dts;
}

function parseCtts(buf: Uint8Array, ctts: Box, sampleCount: number): number[] {
  requireBytes(ctts, 8, "ctts");
  const v = viewOf(buf);
  const entryCount = v.getUint32(ctts.start + 4);
  requireBytes(ctts, 8 + entryCount * 8, "ctts");
  const offsets: number[] = [];
  for (let i = 0; i < entryCount; i += 1) {
    const count = v.getUint32(ctts.start + 8 + i * 8);
    const offset = v.getInt32(ctts.start + 12 + i * 8); // signed, as FFmpeg reads both versions
    if (offsets.length + count > MAX_SAMPLES) throw new VideoInfoError("unsupported", "too many video samples");
    for (let k = 0; k < count; k += 1) offsets.push(offset);
  }
  if (offsets.length !== sampleCount) {
    throw new VideoInfoError("malformed", `ctts covers ${offsets.length} samples but stts covers ${sampleCount}`);
  }
  return offsets;
}

function parseStszCount(buf: Uint8Array, stsz: Box): number {
  requireBytes(stsz, 12, "stsz");
  return viewOf(buf).getUint32(stsz.start + 8);
}

/** Throws unless the track's edit list is one that leaves every sample played. */
function checkEditList(buf: Uint8Array, trak: Box, minPts: number): void {
  const edts = find(buf, trak, "edts");
  if (!edts) return;
  const elst = find(buf, edts, "elst");
  if (!elst) return;
  requireBytes(elst, 8, "elst");
  const v = viewOf(buf);
  const version = buf[elst.start];
  const entryCount = v.getUint32(elst.start + 4);
  const entrySize = version === 1 ? 20 : 12;
  requireBytes(elst, 8 + entryCount * entrySize, "elst");
  let nonEmpty = 0;
  for (let i = 0; i < entryCount; i += 1) {
    const o = elst.start + 8 + i * entrySize;
    const mediaTime = version === 1 ? Number(v.getBigInt64(o + 8)) : v.getInt32(o + 4);
    if (mediaTime === -1) continue; // empty edit: a start delay, which rebasing removes
    nonEmpty += 1;
    // A media_time past the first frame would make FFmpeg drop leading frames; we cannot
    // reproduce that decision from here, so refuse rather than guess.
    if (mediaTime > minPts) {
      throw new VideoInfoError("unsupported", "edit list trims leading frames; frame count cannot be determined");
    }
  }
  if (nonEmpty > 1) throw new VideoInfoError("unsupported", "edit list has several non-empty edits");
}

/** Parses the PAYLOAD of a 'moov' box (without its 8/16-byte header). */
export function parseMoov(moov: Uint8Array): VideoInfo {
  const root = { start: 0, end: moov.length };
  const traks = children(moov, root.start, root.end).filter((b) => b.type === "trak");
  if (find(moov, root, "mvex")) {
    throw new VideoInfoError("unsupported", "fragmented MP4 is not supported");
  }

  for (const trak of traks) {
    const mdia = need(moov, trak, "mdia");
    const hdlr = need(moov, mdia, "hdlr");
    requireBytes(hdlr, 12, "hdlr");
    if (fourcc(moov, hdlr.start + 8) !== "vide") continue;

    const tkhd = need(moov, trak, "tkhd");
    const rotationDegrees = quarterTurnRotation(parseTkhdMatrix(moov, tkhd));
    const timescale = parseMdhdTimescale(moov, need(moov, mdia, "mdhd"));
    const stbl = need(moov, need(moov, mdia, "minf"), "stbl");
    const entry = parseSampleEntry(moov, need(moov, stbl, "stsd"));

    const dts = parseStts(moov, need(moov, stbl, "stts"));
    const stszCount = parseStszCount(moov, need(moov, stbl, "stsz"));
    if (dts.length === 0) throw new VideoInfoError("malformed", "video track has no samples");
    if (dts.length !== stszCount) {
      throw new VideoInfoError("malformed", `stts covers ${dts.length} samples but stsz has ${stszCount}`);
    }
    const ctts = find(moov, stbl, "ctts");
    const offsets = ctts ? parseCtts(moov, ctts, dts.length) : null;
    const pts = dts.map((d, i) => d + (offsets ? offsets[i] : 0));
    pts.sort((a, b) => a - b);
    const first = pts[0];

    checkEditList(moov, trak, first);

    const swap = rotationDegrees === 90 || rotationDegrees === 270;
    return {
      width: swap ? entry.height : entry.width,
      height: swap ? entry.width : entry.height,
      codedWidth: entry.width,
      codedHeight: entry.height,
      rotationDegrees,
      codec: entry.codec,
      frameTimes: pts.map((p) => (p - first) / timescale),
      timescale,
    };
  }
  throw new VideoInfoError("no_video_track", "the file has no video track");
}

/**
 * Finds the top-level 'moov' box using partial reads (box headers only - the
 * huge 'mdat' is skipped), reads just that box, and parses it. Works for
 * moov-at-start (faststart) and moov-at-end files and 64-bit box sizes.
 */
export async function readVideoInfo(src: ByteSource): Promise<VideoInfo> {
  let offset = 0;
  let sawFtyp = false;
  while (offset < src.size) {
    const header = await readExactly(src, offset, Math.min(16, src.size - offset));
    if (header.length < 8) throw new VideoInfoError("truncated", "box header runs past the end of the file");
    const v = viewOf(header);
    let size = v.getUint32(0);
    const type = fourcc(header, 4);
    let headerSize = 8;
    if (offset === 0 && type !== "ftyp" && type !== "moov" && type !== "wide" && type !== "free" && type !== "mdat") {
      throw new VideoInfoError("not_isobmff", "the file does not start with an ISO base media box");
    }
    if (type === "ftyp") sawFtyp = true;
    if (size === 1) {
      if (header.length < 16) throw new VideoInfoError("truncated", "64-bit box header runs past the end of the file");
      size = u64(v, 8);
      headerSize = 16;
    } else if (size === 0) {
      size = src.size - offset;
    }
    if (size < headerSize) throw new VideoInfoError("malformed", `box '${type}' has size ${size}`);
    if (offset + size > src.size) throw new VideoInfoError("truncated", `box '${type}' runs past the end of the file`);

    if (type === "moov") {
      const payload = size - headerSize;
      if (payload > MAX_MOOV_BYTES) throw new VideoInfoError("unsupported", "movie box is implausibly large");
      const bytes = await readExactly(src, offset + headerSize, payload);
      return parseMoov(bytes);
    }
    offset += size;
  }
  throw new VideoInfoError(sawFtyp ? "no_moov" : "not_isobmff", "no movie box found in the file");
}

async function readExactly(src: ByteSource, offset: number, length: number): Promise<Uint8Array> {
  let chunk: Uint8Array;
  try {
    chunk = await src.read(offset, length);
  } catch (err) {
    throw new VideoInfoError("unreadable", err instanceof Error ? err.message : "could not read the file");
  }
  if (chunk.length < length) throw new VideoInfoError("truncated", "file ended before the expected bytes");
  return chunk;
}
