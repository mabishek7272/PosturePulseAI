import { endSession, refreshAccessToken, resetSessionForTests, saveSession } from "./session";
import { UnauthorizedError } from "../api/http";
import * as authApi from "../api/auth";
import * as store from "./tokenStore";

jest.mock("../api/auth");
jest.mock("./tokenStore");

const api = authApi as jest.Mocked<typeof authApi>;
const tokens = store as jest.Mocked<typeof store>;
const pair = (n: number) => ({ accessToken: `a${n}`, refreshToken: `r${n}`, refreshTokenExpiresAt: "2026-12-23T00:00:00.000Z" });

describe("session", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    resetSessionForTests();
    tokens.getRefreshToken.mockResolvedValue("r1");
  });

  it("stores the access and refresh tokens together", async () => {
    await saveSession(pair(1));
    expect(tokens.saveClinicianToken).toHaveBeenCalledWith("a1");
    expect(tokens.saveRefreshToken).toHaveBeenCalledWith("r1");
  });

  it("exchanges the stored refresh token and saves BOTH new tokens (rotation)", async () => {
    api.refreshSession.mockResolvedValue(pair(2));
    await expect(refreshAccessToken("a1")).resolves.toBe("a2");
    expect(api.refreshSession).toHaveBeenCalledWith("r1");
    expect(tokens.saveClinicianToken).toHaveBeenCalledWith("a2");
    expect(tokens.saveRefreshToken).toHaveBeenCalledWith("r2");
  });

  it("shares one renewal between concurrent 401s, so the spent refresh token is never reused", async () => {
    let resolve!: (v: ReturnType<typeof pair>) => void;
    api.refreshSession.mockReturnValue(new Promise((r) => { resolve = r; }));
    const a = refreshAccessToken("a1");
    const b = refreshAccessToken("a1");
    resolve(pair(2));
    await expect(Promise.all([a, b])).resolves.toEqual(["a2", "a2"]);
    expect(api.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("hands a late caller the already-renewed token instead of rotating again", async () => {
    api.refreshSession.mockResolvedValue(pair(2));
    await refreshAccessToken("a1");
    await expect(refreshAccessToken("a1")).resolves.toBe("a2");
    expect(api.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("returns null (session over) when the server refuses the refresh token", async () => {
    api.refreshSession.mockRejectedValue(new UnauthorizedError());
    await expect(refreshAccessToken("a1")).resolves.toBeNull();
  });

  it("returns null when there is no refresh token on the device", async () => {
    tokens.getRefreshToken.mockResolvedValue(null);
    await expect(refreshAccessToken("a1")).resolves.toBeNull();
    expect(api.refreshSession).not.toHaveBeenCalled();
  });

  it("rejects, rather than signing out, when the server cannot be reached", async () => {
    api.refreshSession.mockRejectedValue(new TypeError("Network request failed"));
    await expect(refreshAccessToken("a1")).rejects.toThrow("Network request failed");
    // ... and a later attempt is allowed once the network is back.
    api.refreshSession.mockResolvedValue(pair(2));
    await expect(refreshAccessToken("a1")).resolves.toBe("a2");
  });

  it("revokes the session on the server, then forgets both tokens", async () => {
    api.logoutSession.mockResolvedValue();
    await endSession();
    expect(api.logoutSession).toHaveBeenCalledWith("r1");
    expect(tokens.clearClinicianToken).toHaveBeenCalled();
  });

  it("still forgets the tokens on this device when the server cannot be reached", async () => {
    api.logoutSession.mockRejectedValue(new TypeError("offline"));
    await expect(endSession()).resolves.toBeUndefined();
    expect(tokens.clearClinicianToken).toHaveBeenCalled();
  });

  it("does not call the server when there is no refresh token, but still clears", async () => {
    tokens.getRefreshToken.mockResolvedValue(null);
    await endSession();
    expect(api.logoutSession).not.toHaveBeenCalled();
    expect(tokens.clearClinicianToken).toHaveBeenCalled();
  });
});
