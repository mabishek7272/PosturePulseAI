import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { JwtAuthGuard } from "./jwt-auth.guard";

function contextWithHeader(header: string | undefined) {
  const request: { headers: Record<string, string | undefined>; user?: unknown } = { headers: {} };
  if (header !== undefined) request.headers["authorization"] = header;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    request,
  } as unknown as ExecutionContext & { request: typeof request };
}

describe("JwtAuthGuard", () => {
  it("rejects a request with no Authorization header", async () => {
    const jwt = { verifyAsync: jest.fn() };
    const guard = new JwtAuthGuard(jwt as never);
    await expect(guard.canActivate(contextWithHeader(undefined))).rejects.toThrow(UnauthorizedException);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it("rejects a header that isn't a Bearer token", async () => {
    const jwt = { verifyAsync: jest.fn() };
    const guard = new JwtAuthGuard(jwt as never);
    await expect(guard.canActivate(contextWithHeader("Basic dXNlcjpwYXNz"))).rejects.toThrow(UnauthorizedException);
  });

  it("rejects an invalid/expired token", async () => {
    const jwt = { verifyAsync: jest.fn().mockRejectedValue(new Error("jwt expired")) };
    const guard = new JwtAuthGuard(jwt as never);
    await expect(guard.canActivate(contextWithHeader("Bearer bad.token.here"))).rejects.toThrow(UnauthorizedException);
  });

  it("allows a valid token and attaches the decoded payload to request.user", async () => {
    const payload = { sub: "c1", username: "drchen", role: "clinician" };
    const jwt = { verifyAsync: jest.fn().mockResolvedValue(payload) };
    const guard = new JwtAuthGuard(jwt as never);
    const context = contextWithHeader("Bearer good.token.here");

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(context.request.user).toEqual(payload);
  });
});
