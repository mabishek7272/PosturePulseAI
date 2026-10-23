import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ReportReaderGuard } from "./report-reader.guard";

const jwt = new JwtService({ secret: "test-secret" });
const guard = new ReportReaderGuard(jwt);

function context(token: string | undefined, id = "s1") {
  const request: Record<string, unknown> = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    params: { id },
  };
  return { ctx: { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext, request };
}

const sign = (payload: object) => jwt.signAsync(payload);

describe("ReportReaderGuard", () => {
  it("allows a report-access token for the session", async () => {
    const { ctx, request } = context(await sign({ sub: "p1", sessionId: "s1", role: "report_reader" }));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toMatchObject({ role: "report_reader", sessionId: "s1" });
  });

  it("allows the subject token for the session", async () => {
    const { ctx } = context(await sign({ sub: "p1", sessionId: "s1", role: "subject" }));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("rejects either token for another session", async () => {
    for (const role of ["report_reader", "subject"]) {
      const { ctx } = context(await sign({ sub: "p1", sessionId: "s2", role }));
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    }
  });

  it("rejects a clinician token (clinicians read reports through /reports)", async () => {
    const { ctx } = context(await sign({ sub: "c1", username: "dr", role: "clinician" }));
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it("rejects a missing, malformed or foreign-signed token with 401", async () => {
    await expect(guard.canActivate(context(undefined).ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(context("not.a.jwt").ctx)).rejects.toThrow(UnauthorizedException);
    const foreign = await new JwtService({ secret: "other" }).signAsync({ sessionId: "s1", role: "report_reader" });
    await expect(guard.canActivate(context(foreign).ctx)).rejects.toThrow(UnauthorizedException);
  });
});
