import { SessionGateway } from "./session.gateway";

function client(query: Record<string, unknown>, auth: Record<string, unknown> = {}) {
  return { id: "c", handshake: { query, auth }, join: jest.fn(), disconnect: jest.fn() };
}

function gateway(claims: unknown) {
  const subjectAuth = { verify: jest.fn().mockResolvedValue(claims) };
  return new SessionGateway(subjectAuth as never);
}

describe("SessionGateway.handleConnection", () => {
  it("joins a subject whose token is for the requested session", async () => {
    const c = client({ sessionId: "s1" }, { token: "t" });
    await gateway({ role: "subject", sessionId: "s1", sub: "p1" }).handleConnection(c as never);
    expect(c.join).toHaveBeenCalledWith("session:s1");
    expect(c.disconnect).not.toHaveBeenCalled();
  });

  it("joins a clinician for any session", async () => {
    const c = client({ sessionId: "s1" }, { token: "t" });
    await gateway({ role: "clinician", sub: "c1", username: "dr" }).handleConnection(c as never);
    expect(c.join).toHaveBeenCalledWith("session:s1");
  });

  it("disconnects a subject token for another session", async () => {
    const c = client({ sessionId: "s1" }, { token: "t" });
    await gateway({ role: "subject", sessionId: "s2", sub: "p1" }).handleConnection(c as never);
    expect(c.join).not.toHaveBeenCalled();
    expect(c.disconnect).toHaveBeenCalledWith(true);
  });

  it("disconnects a connection with no valid token", async () => {
    const c = client({ sessionId: "s1" });
    await gateway(null).handleConnection(c as never);
    expect(c.disconnect).toHaveBeenCalledWith(true);
  });

  it("disconnects a connection with no sessionId", async () => {
    const c = client({}, { token: "t" });
    await gateway({ role: "clinician", sub: "c1", username: "dr" }).handleConnection(c as never);
    expect(c.disconnect).toHaveBeenCalledWith(true);
  });
});
