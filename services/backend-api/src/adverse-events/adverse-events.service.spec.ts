import { BadRequestException } from "@nestjs/common";
import { AdverseEventsService, CreateAdverseEventInput } from "./adverse-events.service";

function buildService() {
  const prisma = {
    adverseEvent: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  return { service: new AdverseEventsService(prisma as never), prisma };
}

function validInput(overrides: Partial<CreateAdverseEventInput> = {}): CreateAdverseEventInput {
  return {
    subjectPseudoId: "subj-1",
    reportedByClinicianId: "clin-1",
    onsetAt: "2026-01-01T00:00:00Z",
    description: "Subject reported dizziness during sit-to-stand, resolved after rest.",
    severity: "moderate",
    serious: false,
    causality: "possible",
    outcome: "resolved",
    actionTaken: "session_paused",
    ...overrides,
  };
}

describe("AdverseEventsService", () => {
  it("persists a valid adverse event and returns a schema-valid record", async () => {
    const { service, prisma } = buildService();
    const record = await service.create(validInput());

    expect(record.subjectPseudoId).toBe("subj-1");
    expect(record.sessionId).toBeNull();
    expect(prisma.adverseEvent.create).toHaveBeenCalledTimes(1);
    const persisted = prisma.adverseEvent.create.mock.calls[0][0].data;
    expect(persisted.severity).toBe("moderate");
    expect(persisted.serious).toBe(false);
  });

  it("rejects an unapproved causality value before it ever reaches the database", async () => {
    const { service, prisma } = buildService();
    await expect(
      service.create({ ...validInput(), causality: "made_up" as never })
    ).rejects.toThrow(BadRequestException);
    expect(prisma.adverseEvent.create).not.toHaveBeenCalled();
  });

  it("rejects an unapproved outcome value before it ever reaches the database", async () => {
    const { service, prisma } = buildService();
    await expect(
      service.create({ ...validInput(), outcome: "made_up" as never })
    ).rejects.toThrow(BadRequestException);
    expect(prisma.adverseEvent.create).not.toHaveBeenCalled();
  });

  it("passes sessionId through when the event is tied to a specific session", async () => {
    const { service, prisma } = buildService();
    const record = await service.create(validInput({ sessionId: "s1" }));
    expect(record.sessionId).toBe("s1");
    expect(prisma.adverseEvent.create.mock.calls[0][0].data.sessionId).toBe("s1");
  });

  it("list() filters by seriousOnly, subjectPseudoId, and sessionId", async () => {
    const { service, prisma } = buildService();
    await service.list({ subjectPseudoId: "subj-1", sessionId: "s1", seriousOnly: true });
    expect(prisma.adverseEvent.findMany).toHaveBeenCalledWith({
      where: { subjectPseudoId: "subj-1", sessionId: "s1", serious: true },
      orderBy: { reportedAt: "desc" },
    });
  });

  it("recordEthicsBoardReport stamps the current time", async () => {
    const { service, prisma } = buildService();
    await service.recordEthicsBoardReport("ae1");
    expect(prisma.adverseEvent.update).toHaveBeenCalledWith({
      where: { id: "ae1" },
      data: { reportedToEthicsBoardAt: expect.any(Date) },
    });
  });
});
