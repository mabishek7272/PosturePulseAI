import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { SessionOwnershipGuard } from "./session-ownership.guard";

function context(user: unknown, params: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  return { switchToHttp: () => ({ getRequest: () => ({ user, params, body }) }) } as unknown as ExecutionContext;
}

const subject = (sessionId: string) => ({ sub: "p1", sessionId, role: "subject" });
const guard = new SessionOwnershipGuard();

describe("SessionOwnershipGuard", () => {
  it("allows a subject token for the session in :id", () => {
    expect(guard.canActivate(context(subject("s1"), { id: "s1" }))).toBe(true);
  });

  it("allows a subject token for the session in :sessionId", () => {
    expect(guard.canActivate(context(subject("s1"), { sessionId: "s1" }))).toBe(true);
  });

  it("allows a subject token for the session named in the body", () => {
    expect(guard.canActivate(context(subject("s1"), {}, { sessionId: "s1" }))).toBe(true);
  });

  it("rejects a subject token for a different session", () => {
    expect(() => guard.canActivate(context(subject("s2"), { id: "s1" }))).toThrow(ForbiddenException);
  });

  it("rejects a clinician token on a subject route", () => {
    expect(() => guard.canActivate(context({ sub: "c1", username: "dr", role: "clinician" }, { id: "s1" }))).toThrow(
      ForbiddenException
    );
  });

  it("rejects when the request names no session", () => {
    expect(() => guard.canActivate(context(subject("s1")))).toThrow(ForbiddenException);
  });
});
