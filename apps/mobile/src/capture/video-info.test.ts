import { readFileSync } from "fs";
import { join } from "path";
import { bufferSource, parseMoov, readVideoInfo, VideoInfoError, type ByteSource } from "./video-info";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "__fixtures__", name)));

// Expected values are what ffprobe (frame pts_time, sorted) and PyAV (decoded
// frame size after apply_rotation, frame.rotation) report for each fixture.
// Fixtures were made with ffmpeg: encode 160x120 testsrc2, then
// `-display_rotation N -c copy` so the rotation lives in the tkhd matrix.
const VFR_TIMES = [
  0.0, 0.0333, 0.0667, 0.1667, 0.2, 0.2333, 0.3333, 0.3667, 0.4, 0.5, 0.5333, 0.5667, 0.6667, 0.7, 0.7333, 0.8333,
  0.8667, 0.9, 1.0, 1.0333, 1.0667, 1.1667, 1.2, 1.2333, 1.3333, 1.3667, 1.4, 1.5, 1.5333, 1.5667, 1.6667, 1.7,
  1.7333, 1.8333, 1.8667, 1.9,
];

const CASES: Array<{
  file: string; width: number; height: number; rotation: number; codec: string; frames: number; last: number;
}> = [
  { file: "norot-faststart.mp4", width: 160, height: 120, rotation: 0, codec: "avc1", frames: 30, last: 1.933333 },
  { file: "norot-moov-at-end.mp4", width: 160, height: 120, rotation: 0, codec: "avc1", frames: 30, last: 1.933333 },
  { file: "h264-rot90-faststart.mov", width: 120, height: 160, rotation: 90, codec: "avc1", frames: 30, last: 1.933333 },
  { file: "h264-rot270-moov-at-end.mp4", width: 120, height: 160, rotation: 270, codec: "avc1", frames: 30, last: 1.933333 },
  { file: "h264-rot180.mp4", width: 160, height: 120, rotation: 180, codec: "avc1", frames: 30, last: 1.933333 },
  { file: "hevc-rot90-moov-at-end.mov", width: 120, height: 160, rotation: 90, codec: "hvc1", frames: 30, last: 1.933333 },
  // 100x70 is not macroblock aligned (SPS crops it); the decoded size still equals the sample entry.
  { file: "cropped-100x70-rot90.mp4", width: 70, height: 100, rotation: 90, codec: "avc1", frames: 15, last: 0.933333 },
  { file: "vfr-faststart.mp4", width: 160, height: 120, rotation: 0, codec: "avc1", frames: 36, last: 1.9 },
];

describe("readVideoInfo on real ffmpeg fixtures", () => {
  it.each(CASES)("$file", async (c) => {
    const info = await readVideoInfo(bufferSource(fixture(c.file)));
    expect(info.width).toBe(c.width);
    expect(info.height).toBe(c.height);
    expect(info.rotationDegrees).toBe(c.rotation);
    expect(info.codec).toBe(c.codec);
    expect(info.frameTimes).toHaveLength(c.frames);
    expect(info.frameTimes[0]).toBe(0);
    expect(info.frameTimes[c.frames - 1]).toBeCloseTo(c.last, 5);
    for (let i = 1; i < info.frameTimes.length; i += 1) {
      expect(info.frameTimes[i]!).toBeGreaterThan(info.frameTimes[i - 1]!);
    }
  });

  it("keeps the real, uneven timing of a variable-frame-rate clip", async () => {
    const info = await readVideoInfo(bufferSource(fixture("vfr-faststart.mp4")));
    expect(info.frameTimes.map((t) => Number(t.toFixed(4)))).toEqual(VFR_TIMES);
  });

  it("orders B-frame clips by presentation time (what the decoder emits)", async () => {
    const info = await readVideoInfo(bufferSource(fixture("norot-moov-at-end.mp4")));
    expect(info.frameTimes[1]).toBeCloseTo(1 / 15, 5);
    expect(info.frameTimes[2]).toBeCloseTo(2 / 15, 5);
  });

  it("reads only box headers and the moov box, never the whole file", async () => {
    const bytes = fixture("hevc-rot90-moov-at-end.mov"); // moov after mdat
    const reads: Array<[number, number]> = [];
    const src: ByteSource = {
      size: bytes.length,
      read: async (o, l) => {
        reads.push([o, l]);
        return bytes.subarray(o, o + l);
      },
    };
    await readVideoInfo(src);
    const total = reads.reduce((s, [, l]) => s + l, 0);
    const mdatSize = bytes.length - total;
    expect(mdatSize).toBeGreaterThan(5000); // the mdat payload was skipped
    expect(reads.every(([, l]) => l <= 16 || l < bytes.length / 2)).toBe(true);
  });
});

/** Rebuilds a file with every top-level box, optionally forcing 64-bit headers on moov. */
function rewriteTopLevel(bytes: Uint8Array, force64For: string[]): Uint8Array {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [];
  let o = 0;
  while (o < bytes.length) {
    const size = v.getUint32(o);
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    const body = bytes.subarray(o + 8, o + size);
    if (force64For.includes(type)) {
      const h = new Uint8Array(16);
      const hv = new DataView(h.buffer);
      hv.setUint32(0, 1);
      h.set(bytes.subarray(o + 4, o + 8), 4);
      hv.setUint32(8, 0);
      hv.setUint32(12, size + 8);
      parts.push(h, body);
    } else {
      parts.push(bytes.subarray(o, o + size));
    }
    o += size;
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

describe("box layout handling", () => {
  it("handles 64-bit box sizes on moov and mdat", async () => {
    const bytes = rewriteTopLevel(fixture("h264-rot90-faststart.mov"), ["moov", "mdat"]);
    const info = await readVideoInfo(bufferSource(bytes));
    expect([info.width, info.height, info.frameTimes.length]).toEqual([120, 160, 30]);
  });

  it("treats a size-0 final box as running to end of file", async () => {
    const bytes = fixture("norot-moov-at-end.mp4").slice();
    // moov is the last box: patch its size to 0.
    const v = new DataView(bytes.buffer);
    let o = 0;
    while (o < bytes.length) {
      const size = v.getUint32(o);
      if (String.fromCharCode(...bytes.subarray(o + 4, o + 8)) === "moov") { v.setUint32(o, 0); break; }
      o += size;
    }
    const info = await readVideoInfo(bufferSource(bytes));
    expect(info.frameTimes).toHaveLength(30);
  });
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof VideoInfoError) return err.code;
    throw err;
  }
  return "no error";
}

describe("typed failures", () => {
  it("rejects bytes that are not an ISO-BMFF file", async () => {
    expect(await codeOf(readVideoInfo(bufferSource(new Uint8Array(64).fill(7))))).toBe("not_isobmff");
  });

  it("rejects an empty file", async () => {
    expect(await codeOf(readVideoInfo(bufferSource(new Uint8Array(0))))).toBe("not_isobmff");
  });

  it("reports a missing moov box", async () => {
    const bytes = fixture("norot-moov-at-end.mp4");
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = 0;
    let cut = bytes.length;
    while (o < bytes.length) {
      const size = v.getUint32(o);
      if (String.fromCharCode(...bytes.subarray(o + 4, o + 8)) === "moov") { cut = o; break; }
      o += size;
    }
    expect(await codeOf(readVideoInfo(bufferSource(bytes.subarray(0, cut))))).toBe("no_moov");
  });

  it("reports a truncated file", async () => {
    const bytes = fixture("norot-moov-at-end.mp4");
    expect(await codeOf(readVideoInfo(bufferSource(bytes.subarray(0, bytes.length - 40))))).toBe("truncated");
  });

  it("wraps read failures", async () => {
    const src: ByteSource = { size: 100, read: async () => { throw new Error("EIO"); } };
    expect(await codeOf(readVideoInfo(src))).toBe("unreadable");
  });

  it("refuses fragmented MP4 instead of guessing", () => {
    const box = (type: string, ...payload: Uint8Array[]) => {
      const len = payload.reduce((s, p) => s + p.length, 0);
      const out = new Uint8Array(8 + len);
      new DataView(out.buffer).setUint32(0, 8 + len);
      out.set(new TextEncoder().encode(type), 4);
      let p = 8;
      for (const part of payload) { out.set(part, p); p += part.length; }
      return out;
    };
    const moov = box("mvex");
    expect(() => parseMoov(moov)).toThrow(VideoInfoError);
    expect(() => parseMoov(box("udta"))).toThrow(/no video track/);
  });

  it("refuses a rotation that is not a quarter turn", () => {
    // Patch the tkhd matrix of a real moov to a 45 degree rotation.
    const bytes = fixture("h264-rot90-faststart.mov");
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const copy = bytes.slice();
    const cv = new DataView(copy.buffer);
    // find 'tkhd' and rewrite a,b,c,d
    let at = -1;
    for (let i = 0; i < copy.length - 4; i += 1) {
      if (copy[i] === 0x74 && copy[i + 1] === 0x6b && copy[i + 2] === 0x68 && copy[i + 3] === 0x64) { at = i + 4; break; }
    }
    expect(at).toBeGreaterThan(0);
    const m = at + 40;
    const k = Math.round(0.7071 * 65536);
    cv.setInt32(m, k); cv.setInt32(m + 4, k); cv.setInt32(m + 12, -k); cv.setInt32(m + 16, k);
    void dv;
    return expect(readVideoInfo(bufferSource(copy))).rejects.toMatchObject({ code: "unsupported" });
  });
});
