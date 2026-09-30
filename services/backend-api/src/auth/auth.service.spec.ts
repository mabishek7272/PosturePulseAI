import { UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";

function buildService(clinician: { id: string; username: string; passwordHash: string; role: string } | null) {
  const prisma = { clinician: { findUnique: jest.fn().mockResolvedValue(clinician) } };
  const jwt = { signAsync: jest.fn().mockResolvedValue("signed.jwt.token") };
  return { service: new AuthService(prisma as never, jwt as never), jwt };
}

describe("AuthService", () => {
  it("issues a token for a correct username/password", async () => {
    const passwordHash = await AuthService.hashPassword("correct-password-123");
    const { service, jwt } = buildService({ id: "c1", username: "drchen", passwordHash, role: "clinician" });

    const result = await service.login("drchen", "correct-password-123");

    expect(result).toEqual({ accessToken: "signed.jwt.token" });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: "c1", username: "drchen", role: "clinician" });
  });

  it("rejects an unknown username", async () => {
    const { service } = buildService(null);
    await expect(service.login("nobody", "whatever-password")).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a wrong password for a real username, never issuing a token", async () => {
    const passwordHash = await AuthService.hashPassword("the-real-password-1");
    const { service, jwt } = buildService({ id: "c1", username: "drchen", passwordHash, role: "clinician" });

    await expect(service.login("drchen", "a-wrong-password-1")).rejects.toThrow(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});
