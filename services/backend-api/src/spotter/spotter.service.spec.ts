import { BadRequestException } from "@nestjs/common";
import { getValidator } from "../common/schema-registry";
import { SpotterService, SPOTTER_EVENT_TYPE } from "./spotter.service";

function setup(rows: Array<{ payload: unknown }> = []) {
  const appended: unknown[] = [];
  const events = {
    appendValidated: jest.fn().mockImplementation(async (_sessionId: string, name: string, payload: unknown) => {
      // Mirrors the real EventsService: validate or throw, so a payload this
      // service builds wrongly fails here rather than in production.
      const validate = getValidator(name as "spotter-confirmation");
      if (!validate(payload)) throw new BadRequestException(JSON.stringify(validate.errors));
      appended.push(payload);
      return {};
    }),
  };
  const prisma = { event: { findMany: jest.fn().mockResolvedValue(rows) } };
  return { service: new SpotterService(events as never, prisma as never), events, prisma, appended };
}

describe("SpotterService.confirm", () => {
  it("writes a schema-valid attestation naming the clinician", async () => {
    const { service, appended } = setup();
    const result = await service.confirm({
      sessionId: "s1",
      stepId: "balance.single_left_eyes_closed",
      confirmedBy: "dr.okafor",
    });

    expect(result.confirmationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      sessionId: "s1",
      stepId: "balance.single_left_eyes_closed",
      confirmedBy: "dr.okafor",
      withinArmsReach: true,
      note: null,
    });
  });

  it("records the attestation under its own event type", async () => {
    const { service, events } = setup();
    await service.confirm({ sessionId: "s1", stepId: "x", confirmedBy: "c" });
    expect(events.appendValidated).toHaveBeenCalledWith("s1", SPOTTER_EVENT_TYPE, expect.anything());
  });

  it("keeps an optional clinician note", async () => {
    const { service, appended } = setup();
    await service.confirm({ sessionId: "s1", stepId: "x", confirmedBy: "c", note: "two staff present" });
    expect((appended[0] as { note: string }).note).toBe("two staff present");
  });

  it("can only ever record withinArmsReach: true", async () => {
    // A "no" is not a recordable state - it means the step does not run, so
    // there is nothing to attest to. The schema pins it with `const`, so a
    // stored `false` could never later be read as a confirmation.
    const validate = getValidator("spotter-confirmation");
    expect(
      validate({
        confirmationId: "c-1",
        sessionId: "s1",
        stepId: "x",
        confirmedAt: new Date().toISOString(),
        confirmedBy: "c",
        withinArmsReach: false,
      })
    ).toBe(false);
  });

  it("requires a named confirmer", async () => {
    const validate = getValidator("spotter-confirmation");
    expect(
      validate({
        confirmationId: "c-1",
        sessionId: "s1",
        stepId: "x",
        confirmedAt: new Date().toISOString(),
        withinArmsReach: true,
      })
    ).toBe(false);
  });
});

describe("SpotterService.isConfirmed", () => {
  const row = (stepId: string) => ({ payload: { stepId, withinArmsReach: true } });

  it("is false when nothing has been confirmed", async () => {
    const { service } = setup([]);
    await expect(service.isConfirmed("s1", "balance.a")).resolves.toBe(false);
  });

  it("is true only for the step that was actually confirmed", async () => {
    // Per STEP, never per session. Standing on the left leg and standing on the
    // right are separate steps and separate risks, and one tick must not cover
    // a step the clinician never saw.
    const { service } = setup([row("balance.single_left_eyes_closed")]);
    await expect(service.isConfirmed("s1", "balance.single_left_eyes_closed")).resolves.toBe(true);
    await expect(service.isConfirmed("s1", "balance.single_right_eyes_closed")).resolves.toBe(false);
  });

  it("only reads this session's attestations", async () => {
    const { service, prisma } = setup([row("balance.a")]);
    await service.isConfirmed("s1", "balance.a");
    expect(prisma.event.findMany).toHaveBeenCalledWith({
      where: { sessionId: "s1", type: SPOTTER_EVENT_TYPE },
    });
  });

  it("survives a malformed payload rather than throwing", async () => {
    // The event log is append-only history; a row written by an older build
    // must not break the gate. Unreadable means "not confirmed", which is the
    // safe direction.
    const { service } = setup([{ payload: null }, { payload: "nonsense" }, row("balance.a")]);
    await expect(service.isConfirmed("s1", "balance.a")).resolves.toBe(true);
    await expect(service.isConfirmed("s1", "balance.b")).resolves.toBe(false);
  });
});
