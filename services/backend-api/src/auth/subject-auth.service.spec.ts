import { JwtService } from "@nestjs/jwt";
import { SubjectAuthService } from "./subject-auth.service";

const jwt = new JwtService({ secret: "test-secret" });
const service = new SubjectAuthService(jwt);

describe("SubjectAuthService", () => {
  it("issues a 4h subject token scoped to one session", async () => {
    const token = await service.issueSessionToken("s1", "p1");
    const payload = await jwt.verifyAsync(token);
    expect(payload).toMatchObject({ sub: "p1", sessionId: "s1", role: "subject" });
    expect(payload.exp - payload.iat).toBe(4 * 60 * 60);
  });

  it("verify returns null for missing, malformed, or foreign-signed tokens", async () => {
    expect(await service.verify(undefined)).toBeNull();
    expect(await service.verify("not.a.jwt")).toBeNull();
    const foreign = await new JwtService({ secret: "other-secret" }).signAsync({ role: "clinician" });
    expect(await service.verify(foreign)).toBeNull();
  });

  it("verify returns the claims of a valid token", async () => {
    const token = await service.issueSessionToken("s1", "p1");
    expect(await service.verify(token)).toMatchObject({ sessionId: "s1", role: "subject" });
  });
});
