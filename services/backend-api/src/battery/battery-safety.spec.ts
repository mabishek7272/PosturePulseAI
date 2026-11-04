import { getValidator } from "../common/schema-registry";

/**
 * The schema half of HZ-09.
 *
 * `BatteryService` throws on a battery that does not validate, so a rule
 * encoded here does not merely warn - it stops the service booting with that
 * data. A battery asking someone to stand on one leg with their eyes closed and
 * no spotter cannot reach a patient, because the server carrying it will not
 * start.
 *
 * That is deliberately stronger than leaving it to the author. The field is a
 * boolean a clinician sets by hand, and the one combination where forgetting it
 * matters most is exactly the one hardest to spot in a JSON file.
 */
const step = (overrides: Record<string, unknown> = {}) => ({
  stepId: "balance.test",
  module: "balance",
  title: "t",
  instruction: "i",
  view: "anterior",
  kind: "hold",
  durationSeconds: 10,
  minFps: 24,
  modes: ["clinic"],
  metricKeys: [],
  ...overrides,
});

const battery = (steps: unknown[]) => ({ version: "test", status: "draft", steps });

function validate(steps: unknown[]): boolean {
  return getValidator("assessment-battery")(battery(steps)) as boolean;
}

describe("assessment-battery safety fields", () => {
  it("accepts the existing quiet-standing steps unchanged", () => {
    // Every new field is optional, so the v0 battery in references/ is still
    // valid and nothing about the shipped steps changes.
    expect(validate([step({ stepId: "static.anterior", module: "static" })])).toBe(true);
  });

  it("accepts a balance step that declares a spotter", () => {
    expect(
      validate([step({ eyesClosed: true, stance: "single_left", requiresSpotter: true })])
    ).toBe(true);
  });

  it("REFUSES an eyes-closed step without a spotter", () => {
    expect(validate([step({ eyesClosed: true })])).toBe(false);
    expect(validate([step({ eyesClosed: true, requiresSpotter: false })])).toBe(false);
  });

  it("REFUSES a single-leg step without a spotter, either side", () => {
    expect(validate([step({ stance: "single_left" })])).toBe(false);
    expect(validate([step({ stance: "single_right" })])).toBe(false);
    expect(validate([step({ stance: "single_right", requiresSpotter: false })])).toBe(false);
  });

  it("allows a bilateral eyes-open step to omit the spotter entirely", () => {
    expect(validate([step({ stance: "bilateral", eyesClosed: false })])).toBe(true);
    expect(validate([step()])).toBe(true);
  });

  it("names the two single-leg stances separately", () => {
    // Not a generic `single_leg`: the two are different measurements, and a
    // report that pooled them would be comparing different limbs.
    expect(validate([step({ stance: "single_leg", requiresSpotter: true })])).toBe(false);
  });

  it("carries clinician-authored contraindications and stop rules as free text", () => {
    // Free text because the authority is the clinician, not an enum this repo
    // maintains - and the same shape as protocol-definition's fields, so a
    // clinician writing one does not have to learn two formats.
    expect(
      validate([
        step({
          requiresSpotter: true,
          eyesClosed: true,
          contraindications: ["acute vertigo", "recent lower-limb surgery"],
          symptomStopRules: ["Stop if the person reports dizziness and seat them."],
        }),
      ])
    ).toBe(true);
  });

  it("adds the balance module without disturbing the existing ones", () => {
    for (const module of ["static", "functional", "gait", "workstation", "balance"]) {
      expect(validate([step({ module, requiresSpotter: module === "balance" ? false : undefined })])).toBe(
        true
      );
    }
    expect(validate([step({ module: "freestyle" })])).toBe(false);
  });
});
