import { UnauthorizedError, request, setRefreshHandler, setUnauthorizedHandler } from "./http";

describe("request", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    setUnauthorizedHandler(null);
    setRefreshHandler(null);
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

  describe("token refresh", () => {
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    const unauthorized = { ok: false, status: 401, statusText: "Unauthorized", json: async () => ({}) };

    it("renews the access token on a 401 and retries the call once with it", async () => {
      const fetchMock = jest.fn().mockResolvedValueOnce(unauthorized).mockResolvedValueOnce(ok({ id: "p-1" }));
      global.fetch = fetchMock as unknown as typeof fetch;
      const refresh = jest.fn().mockResolvedValue("fresh-token");
      const onUnauthorized = jest.fn();
      setRefreshHandler(refresh);
      setUnauthorizedHandler(onUnauthorized);

      await expect(request("/patients", { token: "stale" })).resolves.toEqual({ id: "p-1" });

      expect(refresh).toHaveBeenCalledWith("stale");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer stale");
      expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer fresh-token");
      expect(onUnauthorized).not.toHaveBeenCalled();
    });

    it("locks the app only when the session cannot be renewed", async () => {
      global.fetch = jest.fn().mockResolvedValue(unauthorized) as unknown as typeof fetch;
      const onUnauthorized = jest.fn();
      setRefreshHandler(jest.fn().mockResolvedValue(null));
      setUnauthorizedHandler(onUnauthorized);

      await expect(request("/patients", { token: "stale" })).rejects.toBeInstanceOf(UnauthorizedError);
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });

    it("does not loop: a 401 on the retry gives up after exactly one refresh", async () => {
      const fetchMock = jest.fn().mockResolvedValue(unauthorized);
      global.fetch = fetchMock as unknown as typeof fetch;
      const refresh = jest.fn().mockResolvedValue("fresh-token");
      setRefreshHandler(refresh);
      setUnauthorizedHandler(jest.fn());

      await expect(request("/patients", { token: "stale" })).rejects.toBeInstanceOf(UnauthorizedError);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not try to refresh a call that carried no token (login, refresh itself)", async () => {
      global.fetch = jest.fn().mockResolvedValue(unauthorized) as unknown as typeof fetch;
      const refresh = jest.fn();
      setRefreshHandler(refresh);
      setUnauthorizedHandler(jest.fn());

      await expect(request("/auth/login", { method: "POST", body: {} })).rejects.toBeInstanceOf(UnauthorizedError);
      expect(refresh).not.toHaveBeenCalled();
    });

    it("lets a network failure during renewal propagate instead of signing the clinician out", async () => {
      global.fetch = jest.fn().mockResolvedValue(unauthorized) as unknown as typeof fetch;
      const onUnauthorized = jest.fn();
      setRefreshHandler(jest.fn().mockRejectedValue(new TypeError("Network request failed")));
      setUnauthorizedHandler(onUnauthorized);

      await expect(request("/patients", { token: "stale" })).rejects.toThrow("Network request failed");
      expect(onUnauthorized).not.toHaveBeenCalled();
    });

    it("can skip the lock handler, for the refresh call itself", async () => {
      global.fetch = jest.fn().mockResolvedValue(unauthorized) as unknown as typeof fetch;
      const onUnauthorized = jest.fn();
      setUnauthorizedHandler(onUnauthorized);

      await expect(request("/auth/refresh", { method: "POST", body: {}, skipUnauthorizedHandler: true })).rejects.toBeInstanceOf(UnauthorizedError);
      expect(onUnauthorized).not.toHaveBeenCalled();
    });
  });
});
