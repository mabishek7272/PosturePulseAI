import { ConsentService } from "./consent.service";

function buildService(record: { scopes: string[]; revokedAt: Date | null } | null) {
  const prisma = { consentRecord: { findUnique: jest.fn().mockResolvedValue(record) } };
  return new ConsentService(prisma as never);
}

describe("ConsentService.hasActiveScope", () => {
  it("returns false when no consent record exists for the given id", async () => {
    const service = buildService(null);
    expect(await service.hasActiveScope("missing", "wearable_integration")).toBe(false);
  });

  it("returns false when the record exists but lacks the requested scope", async () => {
    const service = buildService({ scopes: ["derived_events"], revokedAt: null });
    expect(await service.hasActiveScope("c1", "wearable_integration")).toBe(false);
  });

  it("returns false when the record has the scope but was revoked", async () => {
    const service = buildService({ scopes: ["wearable_integration"], revokedAt: new Date() });
    expect(await service.hasActiveScope("c1", "wearable_integration")).toBe(false);
  });

  it("returns true when the record is active and has the scope", async () => {
    const service = buildService({ scopes: ["derived_events", "wearable_integration"], revokedAt: null });
    expect(await service.hasActiveScope("c1", "wearable_integration")).toBe(true);
  });
});
