import { login, logoutSession, refreshSession } from "./auth";

describe("auth api", () => {
  afterEach(() => jest.restoreAllMocks());

  it("posts credentials and returns the access and refresh tokens", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ accessToken: "jwt-1", refreshToken: "r-1", refreshTokenExpiresAt: "2026-12-23T00:00:00.000Z" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(login("dr.ben", "pw")).resolves.toMatchObject({ accessToken: "jwt-1", refreshToken: "r-1" });
    expect(fetchMock.mock.calls[0][0]).toContain("/auth/login");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ username: "dr.ben", password: "pw" });
  });

  it("sends the refresh token to /auth/refresh and returns the rotated pair", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ accessToken: "jwt-2", refreshToken: "r-2", refreshTokenExpiresAt: "x" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(refreshSession("r-1")).resolves.toMatchObject({ accessToken: "jwt-2", refreshToken: "r-2" });
    expect(fetchMock.mock.calls[0][0]).toContain("/auth/refresh");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refreshToken: "r-1" });
  });

  it("logs out with the refresh token and tolerates the empty 204 body", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error("no body"); } });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(logoutSession("r-1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toContain("/auth/logout");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refreshToken: "r-1" });
  });
});
