import { ConflictException, UnauthorizedException, BadRequestException } from "@nestjs/common";
import { PatientAuthService } from "./patient-auth.service";

function buildService(existing: { id: string; email: string; passwordHash: string } | null) {
  const prisma = {
    patient: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data })),
    },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue("signed.jwt.token") };
  return { service: new PatientAuthService(prisma as never, jwt as never), prisma, jwt };
}

describe("PatientAuthService.signup", () => {
  it("creates a patient and issues a token", async () => {
    const { service, prisma, jwt } = buildService(null);
    const result = await service.signup("new@example.com", "correct-password-123");

    expect(result).toEqual({ accessToken: "signed.jwt.token" });
    expect(prisma.patient.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: "new@example.com" }),
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ email: "new@example.com", role: "patient" }));
  });

  it("rejects a password shorter than 12 characters", async () => {
    const { service } = buildService(null);
    await expect(service.signup("new@example.com", "short")).rejects.toThrow(BadRequestException);
  });

  it("rejects a malformed email", async () => {
    const { service } = buildService(null);
    await expect(service.signup("not-an-email", "correct-password-123")).rejects.toThrow(BadRequestException);
  });

  it("rejects a duplicate email", async () => {
    const { service } = buildService({ id: "p0", email: "taken@example.com", passwordHash: "x" });
    await expect(service.signup("taken@example.com", "correct-password-123")).rejects.toThrow(ConflictException);
  });
});

describe("PatientAuthService.login", () => {
  it("issues a token for a correct email/password", async () => {
    const passwordHash = await PatientAuthService.hashPassword("correct-password-123");
    const { service, jwt } = buildService({ id: "p1", email: "patient@example.com", passwordHash });

    const result = await service.login("patient@example.com", "correct-password-123");

    expect(result).toEqual({ accessToken: "signed.jwt.token" });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: "p1", email: "patient@example.com", role: "patient" });
  });

  it("rejects an unknown email", async () => {
    const { service } = buildService(null);
    await expect(service.login("nobody@example.com", "whatever-password")).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a wrong password, never issuing a token", async () => {
    const passwordHash = await PatientAuthService.hashPassword("the-real-password-1");
    const { service, jwt } = buildService({ id: "p1", email: "patient@example.com", passwordHash });

    await expect(service.login("patient@example.com", "a-wrong-password-1")).rejects.toThrow(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});
