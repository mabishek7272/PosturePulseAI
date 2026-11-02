import { UnauthorizedError, request, setUnauthorizedHandler } from "./http";

describe("request", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    setUnauthorizedHandler(null);
  });

  it("returns parsed JSON on success", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ id: "p-1" }),
    }) as unknown as typeof fetch;

    await expect(request<{ id: string }>("/patients")).resolves.toEqual({ id: "p-1" });
  });

  it("sends the bearer token when given one", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await request("/patients", { token: "tok-123" });

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer tok-123");
  });

  it("throws UnauthorizedError on 401 and notifies the handler", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 401, statusText: "Unauthorized", json: async () => ({}),
    }) as unknown as typeof fetch;
    const onUnauthorized = jest.fn();
    setUnauthorizedHandler(onUnauthorized);

    await expect(request("/patients")).rejects.toBeInstanceOf(UnauthorizedError);
    // An expired token must not linger, or every later screen retries with it.
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("surfaces the server's message rather than a generic failure", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 403, statusText: "Forbidden",
      json: async () => ({ message: "Token is not valid for this session." }),
    }) as unknown as typeof fetch;

    await expect(request("/sessions/s-1/clips/front")).rejects.toThrow(
      "Token is not valid for this session."
    );
  });
});
