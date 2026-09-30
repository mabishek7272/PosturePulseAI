import { ForbiddenException } from "@nestjs/common";
import { ResearchExportService } from "./research-export.service";

const SESSION = {
  id: "s1",
  subjectPseudoId: "subj-1",
  protocolId: "bodyweight-squat",
  protocolVersion: "v0-draft",
  deploymentContext: "clinic_supervised",
  consentRecordId: "consent-1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const EVENTS = [
  {
    id: "e1",
    sessionId: "s1",
    type: "quality-gate-flag",
    schemaId: "quality-gate-flag/v0",
    payload: { flagId: "f1", state: "supported" },
    createdAt: new Date("2026-01-01T00:00:05Z"),
  },
];

function buildService(hasConsent: boolean) {
  const sessions = { get: jest.fn().mockResolvedValue(SESSION) };
  const events = { listForSession: jest.fn().mockResolvedValue(EVENTS) };
  const consent = { hasActiveScope: jest.fn().mockResolvedValue(hasConsent) };
  return {
    service: new ResearchExportService(sessions as never, events as never, consent as never),
    sessions,
    events,
    consent,
  };
}

describe("ResearchExportService", () => {
  it("throws Forbidden when the subject has not consented to research_data_export", async () => {
    const { service, consent } = buildService(false);
    await expect(service.exportSession("s1")).rejects.toThrow(ForbiddenException);
    expect(consent.hasActiveScope).toHaveBeenCalledWith("consent-1", "research_data_export");
  });

  it("exports session metadata + events, keyed only by the pseudonymous subject id", async () => {
    const { service } = buildService(true);
    const bundle = await service.exportSession("s1");

    expect(bundle.subjectPseudoId).toBe("subj-1");
    expect(bundle.protocolId).toBe("bodyweight-squat");
    expect(bundle.events).toEqual([
      { type: "quality-gate-flag", schemaId: "quality-gate-flag/v0", payload: EVENTS[0].payload, recordedAt: EVENTS[0].createdAt },
    ]);

    // Never leaks the consent record id or any field beyond subjectPseudoId that could re-identify.
    expect(bundle).not.toHaveProperty("consentRecordId");
    expect(Object.keys(bundle).sort()).toEqual(
      ["deploymentContext", "events", "protocolId", "protocolVersion", "sessionCreatedAt", "subjectPseudoId"].sort()
    );
  });
});
