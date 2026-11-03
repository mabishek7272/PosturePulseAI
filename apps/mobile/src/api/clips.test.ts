import { clipMediaType, uploadClip } from "./clips";

jest.mock("expo-file-system", () => ({
  File: jest.fn().mockImplementation(() => ({
    bytes: () => Promise.resolve(new Uint8Array([1, 2, 3])),
  })),
}));
import type { ClipCapture } from "../capture/sidecar";

const sidecar = { clipId: "c-1", sessionId: "s-1", stepId: "static.anterior" } as unknown as ClipCapture;

describe("clipMediaType", () => {
  it("declares quicktime for an iOS .mov recording", () => {
    expect(clipMediaType("/var/tmp/clip.mov")).toEqual({ extension: "mov", contentType: "video/quicktime" });
  });

  it("declares mp4 for an Android recording, which always writes .mp4", () => {
    expect(clipMediaType("/data/user/0/clip.mp4")).toEqual({ extension: "mp4", contentType: "video/mp4" });
  });

  it("is case-insensitive about the extension", () => {
    expect(clipMediaType("/tmp/CLIP.MP4").contentType).toBe("video/mp4");
  });

  it("falls back to quicktime when the path has no usable extension", () => {
    // The server accepts both types, so a wrong guess would be stored
    // mislabelled rather than rejected - quicktime matches the iOS default.
    expect(clipMediaType("/tmp/clip").contentType).toBe("video/quicktime");
  });
});

describe("uploadClip", () => {
  afterEach(() => jest.restoreAllMocks());

  it("PUTs multipart to the step's clip route", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ clipId: "c-1", status: "accepted" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await uploadClip({
      sessionId: "s-1", stepId: "static.anterior",
      videoPath: "file:///tmp/clip.mov", sidecar, token: "subj-tok",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/sessions/s-1/clips/static.anterior");
    expect(init.method).toBe("PUT");
  });

  it("sends the session token, since a clinician token is rejected with 403", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ clipId: "c-1", status: "accepted" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await uploadClip({
      sessionId: "s-1", stepId: "static.anterior",
      videoPath: "file:///tmp/clip.mov", sidecar, token: "subj-tok",
    });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer subj-tok");
  });

  it("does not set Content-Type, so fetch can add the multipart boundary", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ clipId: "c-1", status: "accepted" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await uploadClip({
      sessionId: "s-1", stepId: "static.anterior",
      videoPath: "file:///tmp/clip.mov", sidecar, token: "subj-tok",
    });

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers["content-type"]).toBeUndefined();
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("surfaces the server's rejection reason instead of dropping the clip silently", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 409, statusText: "Conflict",
      json: async () => ({ message: "This step already has an accepted clip." }),
    }) as unknown as typeof fetch;

    await expect(
      uploadClip({
        sessionId: "s-1", stepId: "static.anterior",
        videoPath: "file:///tmp/clip.mov", sidecar, token: "subj-tok",
      })
    ).rejects.toThrow("This step already has an accepted clip.");
  });

  it("sends the clip as a part exposing bytes(), the only shape Expo's fetch accepts", async () => {
    // Node's FormData flattens object parts, so record what uploadClip appends.
    const RealFormData = global.FormData;
    global.FormData = class {
      parts: Record<string, unknown> = {};
      append(key: string, value: unknown) { this.parts[key] = value; }
    } as unknown as typeof FormData;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ clipId: "c-1", status: "accepted" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await uploadClip({
      sessionId: "s-1", stepId: "static.anterior",
      videoPath: "/tmp/clip.mov", sidecar, token: "subj-tok",
    });

    const form = fetchMock.mock.calls[0][1].body as unknown as { parts: Record<string, unknown> };
    const part = form.parts.clip as { name: string; type: string; bytes: () => Promise<Uint8Array> };
    expect(part).not.toHaveProperty("uri");
    expect(part.name).toBe("static.anterior.mov");
    expect(part.type).toBe("video/quicktime");
    expect(Array.from(await part.bytes())).toEqual([1, 2, 3]);
    global.FormData = RealFormData;
  });
});
