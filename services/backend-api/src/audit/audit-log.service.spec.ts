import { AuditLogService } from "./audit-log.service";

function buildService(createImpl: () => Promise<unknown> = () => Promise.resolve({})) {
  const prisma = {
    auditLogEntry: {
      create: jest.fn(createImpl),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  return { service: new AuditLogService(prisma as never), prisma };
}

describe("AuditLogService", () => {
  it("records an access with a null sessionId when none is given", async () => {
    const { service, prisma } = buildService();
    await service.record({ clinicianId: "c1", clinicianUsername: "drchen", action: "list_sessions" });

    expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
      data: { clinicianId: "c1", clinicianUsername: "drchen", action: "list_sessions", sessionId: null },
    });
  });

  it("records the sessionId when one is given", async () => {
    const { service, prisma } = buildService();
    await service.record({ clinicianId: "c1", clinicianUsername: "drchen", action: "view_session", sessionId: "s1" });

    expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
      data: { clinicianId: "c1", clinicianUsername: "drchen", action: "view_session", sessionId: "s1" },
    });
  });

  it("swallows a database failure rather than throwing into the read it's auditing", async () => {
    const { service } = buildService(() => Promise.reject(new Error("db down")));
    await expect(service.record({ clinicianId: "c1", clinicianUsername: "drchen", action: "view_session" })).resolves.toBeUndefined();
  });

  it("lists entries most-recent-first with a default limit of 100", async () => {
    const { service, prisma } = buildService();
    await service.list();
    expect(prisma.auditLogEntry.findMany).toHaveBeenCalledWith({ orderBy: { occurredAt: "desc" }, take: 100 });
  });

  it("respects a custom limit", async () => {
    const { service, prisma } = buildService();
    await service.list(10);
    expect(prisma.auditLogEntry.findMany).toHaveBeenCalledWith({ orderBy: { occurredAt: "desc" }, take: 10 });
  });
});
