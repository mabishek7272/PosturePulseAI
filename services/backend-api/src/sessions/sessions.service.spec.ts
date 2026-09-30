import { ForbiddenException } from "@nestjs/common";
import { SessionsService } from "./sessions.service";

const retention = (optIn: boolean) => ({
  rawVideo: { optIn, retentionDays: optIn ? 7 : null },
  derivedEvents: { retentionDays: 30 },
});

const input = (overrides: Record<string, unknown> = {}) => ({
  subjectPseudoId: "p1",
  protocolId: "bodyweight-squat",
  protocolVersion: "v0-draft",
  deploymentContext: "clinic_supervised" as const,
  consentRecordId: "c1",
  retentionPolicy: retention(false),
  ...overrides,
});

function build(consent: { subjectPseudoId: string; scopes: string[] } | null) {
  const prisma = {
    session: {
      create: jest.fn().mockResolvedValue(undefined),
      findUniqueOrThrow: jest.fn().mockImplementation(({ where }) => Promise.resolve({ id: where.id, state: "Setup" })),
    },
  };
  const safety = { startSession: jest.fn().mockResolvedValue(undefined) };
  const consentService = { findActive: jest.fn().mockResolvedValue(consent) };
  const subjectAuth = { issueSessionToken: jest.fn().mockResolvedValue("signed.token") };
  const service = new SessionsService(
    prisma as never, safety as never, {} as never, consentService as never, subjectAuth as never
  );
  return { service, prisma, subjectAuth };
}

describe("SessionsService.create", () => {
  it("rejects a missing or revoked consent record", async () => {
    const { service, prisma } = build(null);
    await expect(service.create(input())).rejects.toThrow(ForbiddenException);
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it("rejects a consent record belonging to another subject", async () => {
    const { service } = build({ subjectPseudoId: "p2", scopes: ["derived_events"] });
    await expect(service.create(input())).rejects.toThrow(ForbiddenException);
  });

  it("rejects consent without the derived_events scope", async () => {
    const { service } = build({ subjectPseudoId: "p1", scopes: ["raw_video"] });
    await expect(service.create(input())).rejects.toThrow(ForbiddenException);
  });

  it("rejects raw video opt-in without the raw_video scope", async () => {
    const { service } = build({ subjectPseudoId: "p1", scopes: ["derived_events"] });
    await expect(service.create(input({ retentionPolicy: retention(true) }))).rejects.toThrow(ForbiddenException);
  });

  it("creates the session and returns it with a session-scoped token", async () => {
    const { service, prisma, subjectAuth } = build({ subjectPseudoId: "p1", scopes: ["derived_events"] });
    const result = await service.create(input());
    expect(prisma.session.create).toHaveBeenCalledTimes(1);
    expect(result.session.state).toBe("Setup");
    expect(result.sessionToken).toBe("signed.token");
    expect(subjectAuth.issueSessionToken).toHaveBeenCalledWith(result.session.id, "p1");
  });
});
