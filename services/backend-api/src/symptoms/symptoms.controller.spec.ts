import { SymptomsController } from "./symptoms.controller";

function build(claims: unknown) {
  const events = { appendValidated: jest.fn().mockResolvedValue(undefined) };
  const safety = { reportSymptom: jest.fn().mockResolvedValue("Pause") };
  const gateway = { broadcast: jest.fn() };
  const subjectAuth = { verify: jest.fn().mockResolvedValue(claims) };
  const controller = new SymptomsController(events as never, safety as never, gateway as never, subjectAuth as never);
  const warn = jest.spyOn((controller as unknown as { logger: { warn: () => void } }).logger, "warn").mockImplementation();
  return { controller, safety, warn };
}

const body = { sessionId: "s1", symptoms: ["dizziness"], severity: "moderate" as const };

describe("SymptomsController.report", () => {
  it("pauses the session even with no token, and logs it", async () => {
    const { controller, safety, warn } = build(null);
    await expect(controller.report(body, undefined)).resolves.toMatchObject({ state: "Pause" });
    expect(safety.reportSymptom).toHaveBeenCalledWith("s1", expect.any(String), "pause");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("pauses the session with a token for another session, and logs it", async () => {
    const { controller, safety, warn } = build({ role: "subject", sessionId: "s2", sub: "p1" });
    await expect(controller.report(body, "Bearer t")).resolves.toMatchObject({ state: "Pause" });
    expect(safety.reportSymptom).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not log a report carrying this session's token", async () => {
    const { controller, warn } = build({ role: "subject", sessionId: "s1", sub: "p1" });
    await controller.report(body, "Bearer t");
    expect(warn).not.toHaveBeenCalled();
  });
});
