import { login } from "./auth";

describe("login", () => {
  afterEach(() => jest.restoreAllMocks());

  it("posts credentials and returns the access token", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ accessToken: "jwt-1" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(login("dr.ben", "pw")).resolves.toBe("jwt-1");
    expect(fetchMock.mock.calls[0][0]).toContain("/auth/login");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      username: "dr.ben", password: "pw",
    });
  });
});
