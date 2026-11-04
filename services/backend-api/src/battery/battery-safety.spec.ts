import { getValidator } from "../common/schema-registry";
import { assertSubBlocksConsistent, BatteryService } from "./battery.service";

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

describe("sub-block consistency, checked at boot", () => {
  const block = (phase: string, durationSeconds: number) => ({
    phase,
    durationSeconds,
    instruction: "x",
  });

  const holdWith = (overrides: Record<string, unknown>) =>
    step({ kind: "hold", durationSeconds: 22, ...overrides });

  it("accepts the 10/6/6 protocol against a 22 s step", () => {
    expect(
      validate([
        holdWith({
          subBlocks: [block("relaxed", 10), block("habitual", 6), block("standardized", 6)],
        }),
      ])
    ).toBe(true);
  });

  it("REFUSES sub-blocks on a reps or passes step", () => {
    // Splitting by time would cut across repetitions, which have their own
    // natural segmentation.
    expect(validate([step({ kind: "reps", reps: 5, subBlocks: [block("relaxed", 2), block("habitual", 2)] })])).toBe(
      false
    );
  });

  it("REFUSES a single sub-block", () => {
    expect(validate([holdWith({ subBlocks: [block("relaxed", 22)] })])).toBe(false);
  });

  it("REFUSES an unknown phase name", () => {
    expect(validate([holdWith({ subBlocks: [block("warmup", 11), block("relaxed", 11)] })])).toBe(false);
  });

  it("REFUSES an unexpected field inside a sub-block", () => {
    expect(
      validate([
        holdWith({
          subBlocks: [{ ...block("relaxed", 11), cueAudio: "beep.mp3" }, block("habitual", 11)],
        }),
      ])
    ).toBe(false);
  });

  // --- the two rules JSON Schema cannot express ---

  it("rejects durations that do not sum to the step's own duration", () => {
    // Schema-valid but wrong: the last phase would either be truncated or run
    // past the end of the recording. `BatteryService` throws, so the service
    // does not start with this data.
    expect(() =>
      assertSubBlocksConsistent(
        holdWith({
          durationSeconds: 22,
          subBlocks: [block("relaxed", 10), block("habitual", 6), block("standardized", 5)],
        }) as never
      )
    ).toThrow(/sum to 21s but the step declares 22s/);
  });

  it("accepts hand-authored decimals that sum within float tolerance", () => {
    // 1.1 + 2.2 + 6.7 is not exactly 10 in binary floating point; an equality
    // check would reject a correct battery.
    expect(() =>
      assertSubBlocksConsistent(
        holdWith({
          durationSeconds: 10,
          subBlocks: [block("relaxed", 1.1), block("habitual", 2.2), block("standardized", 6.7)],
        }) as never
      )
    ).not.toThrow();
  });

  it("rejects a repeated phase name", () => {
    // A frame's `subPhase` tag would be ambiguous: the analysis could not tell
    // which block it belonged to.
    expect(() =>
      assertSubBlocksConsistent(
        holdWith({
          durationSeconds: 22,
          subBlocks: [block("relaxed", 11), block("relaxed", 11)],
        }) as never
      )
    ).toThrow(/repeats sub-phase "relaxed"/);
  });

  it("rejects sub-blocks with no step duration to check them against", () => {
    expect(() =>
      assertSubBlocksConsistent({
        stepId: "x",
        subBlocks: [block("relaxed", 5), block("habitual", 5)],
      } as never)
    ).toThrow(/no durationSeconds/);
  });

  it("passes a step with no sub-blocks straight through", () => {
    expect(() => assertSubBlocksConsistent(step() as never)).not.toThrow();
    expect(() => assertSubBlocksConsistent({ stepId: "x", subBlocks: [] } as never)).not.toThrow();
  });

  it("the shipped battery still loads", () => {
    // Every new field is optional, so references/assessment-battery.v0-draft.json
    // is untouched and must remain valid.
    const service = new BatteryService();
    expect(service.battery.steps.length).toBeGreaterThan(0);
    for (const s of service.battery.steps) {
      expect(() => assertSubBlocksConsistent(s)).not.toThrow();
    }
  });
});
